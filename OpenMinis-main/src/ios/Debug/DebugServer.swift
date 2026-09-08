#if DEBUG
import Darwin
import Foundation

final class DebugServer: @unchecked Sendable {

    private let acceptQueue = DispatchQueue(label: "debug.server.accept")
    private var listenSocket: Int32 = -1
    private var stopped = false
    private var rpc: DebugJSONRPC?

    func start(port: UInt16 = 8321) throws {
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        guard fd >= 0 else {
            print("[DebugServer] Failed to create socket")
            return
        }

        var reuse: Int32 = 1
        setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &reuse, socklen_t(MemoryLayout<Int32>.size))

        var addr = sockaddr_in()
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = port.bigEndian
        addr.sin_addr.s_addr = INADDR_ANY

        let bindResult = withUnsafePointer(to: &addr) { ptr in
            ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockPtr in
                bind(fd, sockPtr, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        guard bindResult == 0 else {
            close(fd)
            print("[DebugServer] Failed to bind port \(port): errno \(errno)")
            return
        }

        guard listen(fd, 5) == 0 else {
            close(fd)
            print("[DebugServer] Failed to listen on port \(port)")
            return
        }

        self.listenSocket = fd
        print("[DebugServer] Listening on http://0.0.0.0:\(port)")

        // Initialize inspector + RPC on main actor, then start accept loop
        Task { @MainActor in
            let inspector = DebugViewInspector()
            self.rpc = DebugJSONRPC(inspector: inspector)
            self.acceptQueue.async { [weak self] in
                self?.acceptLoop()
            }
        }
    }

    func stop() {
        stopped = true
        if listenSocket >= 0 {
            close(listenSocket)
            listenSocket = -1
        }
    }

    /// [T-ios-debug-server-background-restart] iOS may suspend the app for
    /// long enough that the kernel tears down the listen socket's queue: the
    /// accept loop keeps running but no new TCP connection ever lands, so
    /// after a long-background → foreground cycle :8321 looks "up" from the
    /// app side but is dead to clients. Call this from scenePhase.active.
    ///
    /// First attempt (b86c347e) tried a TCP "probe" via non-blocking
    /// connect() to 127.0.0.1:<port>. It MISLED us: BSD-side connect()
    /// completes the TCP three-way handshake into the kernel's listen backlog
    /// even when the userspace accept thread is dead (no one will ever drain
    /// the connection from the queue, but connect() doesn't know that), so the
    /// probe reported "healthy" while the server was effectively dead.
    ///
    /// Replace the probe with an unconditional teardown + re-bind. SO_REUSEADDR
    /// was set on the original bind so re-binding succeeds immediately; the old
    /// accept thread receives EBADF on its blocked accept() (close-then-listen)
    /// and the EBADF branch in acceptLoop already breaks cleanly. Total cost is
    /// ~ms on the foreground transition — cheaper than risking a "dead but
    /// looks alive" socket again.
    func restartIfDead(port: UInt16 = 8321) {
        if listenSocket >= 0 {
            print("[DebugServer] foreground transition — rebuilding listener on :\(port)")
            close(listenSocket)
            listenSocket = -1
        }
        stopped = false
        try? start(port: port)
    }

    // MARK: - Private

    private func acceptLoop() {
        while !stopped && listenSocket >= 0 {
            var clientAddr = sockaddr_in()
            var addrLen = socklen_t(MemoryLayout<sockaddr_in>.size)

            let clientFd = withUnsafeMutablePointer(to: &clientAddr) { ptr in
                ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockPtr in
                    accept(listenSocket, sockPtr, &addrLen)
                }
            }

            if clientFd < 0 {
                if stopped { break }
                let err = errno
                // Permanent socket failures: listenSocket is unusable and
                // accept() will keep returning -1 immediately, pegging this
                // worker thread at 100% CPU and overheating the device.
                // Exit the loop instead of spinning.
                if err == EBADF || err == EINVAL || err == ENOTSOCK {
                    print("[DebugServer] accept fatal errno=\(err), stopping accept loop")
                    break
                }
                // Transient errors (e.g. ECONNABORTED): short sleep so a
                // sustained error stream doesn't busy-spin. EINTR is normal
                // signal interruption and retries immediately.
                if err != EINTR {
                    usleep(50_000) // 50ms
                }
                continue
            }
            // Hand off to a Task — never block GCD workers while awaiting
            // an async RPC, or the global pool will saturate after a handful
            // of in-flight requests and new connections will stop dispatching.
            let fd = clientFd
            // Loopback peers (127.0.0.0/8) are USB/iproxy or on-device callers;
            // pairing's plain-grant mode is restricted to them.
            let peerIsLoopback = (clientAddr.sin_addr.s_addr.bigEndian >> 24) == 127
            Task.detached { [weak self] in
                await self?.handleConnection(fd, peerIsLoopback: peerIsLoopback)
            }
        }
    }

    private func handleConnection(_ fd: Int32, peerIsLoopback: Bool) async {
        // Move the blocking BSD-socket read off the calling thread.
        let parsed: (method: String, path: String, accept: String, body: String)? = await Task.detached { [weak self] in
            self?.readHTTPRequest(fd)
        }.value

        guard let (method, path, accept, body) = parsed else {
            sendResponse(fd, status: "400 Bad Request", body: errorJSON(-32700, "Parse error", nil))
            close(fd)
            return
        }

        let auth = DebugAuthenticator.shared

        func schemaJSON() -> String {
            let info = Bundle.main.infoDictionary ?? [:]
            return """
            {"app":"MinisApp","version":"\(info["CFBundleShortVersionString"] as? String ?? "?")",\
            "rpc":"jsonrpc-2.0","auth":"\(auth.authRequired ? "v1" : "off")",\
            "pair_path":"/pair","rpc_path":"/rpc","skill_path":"/skill"}
            """
        }

        // Unauthenticated capability discovery — lets clients detect the
        // required transport before sending anything sensitive.
        if method == "GET" && path == "/schema" {
            sendResponse(fd, status: "200 OK", body: schemaJSON())
            close(fd)
            return
        }

        // Unauthenticated onboarding: serve the debug-server skill (protocol
        // manual + reference clients) so a client that doesn't yet know the
        // v1 envelope can fetch, read, and implement it. No secrets here —
        // just documentation and example code baked in at build time.
        if method == "GET" {
            let wantsHuman = accept.contains("text/html") || accept.contains("text/markdown") || accept.contains("text/plain")
            switch path {
            case "/", "/skill", "/skill/":
                if path == "/" && !wantsHuman {
                    // Bare `GET /` from a tool defaults to the machine schema,
                    // preserving prior behavior; browsers get the skill.
                    sendResponse(fd, status: "200 OK", body: schemaJSON())
                } else {
                    sendSkill(fd, wantsHuman: wantsHuman)
                }
                close(fd)
                return
            case "/skill/examples/python", "/skill/examples/minis_rpc.py":
                sendSkillClient(fd, base64: DebugSkillGenerated.clientPythonB64, contentType: "text/x-python; charset=utf-8")
                close(fd)
                return
            case "/skill/examples/node", "/skill/examples/minis_rpc.mjs":
                sendSkillClient(fd, base64: DebugSkillGenerated.clientNodeB64, contentType: "text/javascript; charset=utf-8")
                close(fd)
                return
            case "/skill/examples/bash", "/skill/examples/minis_rpc.sh":
                sendSkillClient(fd, base64: DebugSkillGenerated.clientBashB64, contentType: "text/x-shellscript; charset=utf-8")
                close(fd)
                return
            default:
                break
            }
        }

        guard method == "POST" else {
            sendResponse(fd, status: "405 Method Not Allowed", body: errorJSON(-32600, "Only POST accepted", nil))
            close(fd)
            return
        }

        guard !body.isEmpty else {
            sendResponse(fd, status: "400 Bad Request", body: errorJSON(-32700, "Empty body", nil))
            close(fd)
            return
        }

        if path == "/pair" {
            let obj = (try? JSONSerialization.jsonObject(with: Data(body.utf8))) as? [String: Any] ?? [:]
            let (status, json) = await auth.handlePair(body: obj, isLoopback: peerIsLoopback)
            sendResponse(fd, status: status, body: json)
            close(fd)
            return
        }

        guard let rpcRef = self.rpc else {
            sendResponse(fd, status: "503 Service Unavailable", body: errorJSON(-32000, "Server not ready", nil))
            close(fd)
            return
        }

        // Envelope requests are handled regardless of the auth switch so
        // migrated clients keep working even while legacy mode is allowed.
        let bodyObj = (try? JSONSerialization.jsonObject(with: Data(body.utf8))) as? [String: Any]
        if let obj = bodyObj, DebugAuthenticator.looksLikeEnvelope(obj) {
            do {
                let (plaintext, sealResponse) = try auth.openEnvelope(obj)
                let responseJSON = await rpcRef.handle(json: plaintext)
                sendResponse(fd, status: "200 OK", body: sealResponse(responseJSON))
            } catch let failure as DebugAuthenticator.AuthFailure {
                sendResponse(fd, status: "401 Unauthorized",
                             body: DebugAuthenticator.authErrorJSON(failure.code, failure.message))
            } catch {
                sendResponse(fd, status: "401 Unauthorized",
                             body: DebugAuthenticator.authErrorJSON("bad_envelope", error.localizedDescription))
            }
            close(fd)
            return
        }

        // Plain JSON-RPC: allowed only while the auth switch is off.
        guard !auth.authRequired else {
            sendResponse(fd, status: "401 Unauthorized",
                         body: DebugAuthenticator.authErrorJSON("auth_required", "Pair via /pair and use the encrypted envelope"))
            close(fd)
            return
        }

        let responseJSON = await rpcRef.handle(json: body)
        sendResponse(fd, status: "200 OK", body: responseJSON)
        close(fd)
    }

    private func readHTTPRequest(_ fd: Int32) -> (method: String, path: String, accept: String, body: String)? {
        var headerData = Data()
        var buffer = [UInt8](repeating: 0, count: 1)

        // Read until we find \r\n\r\n (end of headers)
        while headerData.count < 16384 {
            let n = read(fd, &buffer, 1)
            guard n == 1 else { return nil }
            headerData.append(buffer[0])

            if headerData.count >= 4 {
                let end = headerData.suffix(4)
                if end.elementsEqual([0x0D, 0x0A, 0x0D, 0x0A]) {
                    break
                }
            }
        }

        guard let headerString = String(data: headerData, encoding: .utf8),
              let firstLine = headerString.split(separator: "\r\n").first else {
            return nil
        }

        let parts = firstLine.split(separator: " ")
        guard parts.count >= 2 else { return nil }
        let method = String(parts[0])
        // Path only — strip any query string.
        let path = String(parts[1].split(separator: "?")[0])

        // Parse Content-Length and Accept
        var contentLength = 0
        var accept = ""
        for line in headerString.split(separator: "\r\n") {
            let lower = line.lowercased()
            if lower.hasPrefix("content-length:") {
                let value = line.dropFirst("content-length:".count).trimmingCharacters(in: .whitespaces)
                contentLength = Int(value) ?? 0
            } else if lower.hasPrefix("accept:") {
                accept = String(lower.dropFirst("accept:".count)).trimmingCharacters(in: .whitespaces)
            }
        }

        // Read body
        var body = ""
        if contentLength > 0 {
            var bodyBuffer = [UInt8](repeating: 0, count: contentLength)
            var totalRead = 0
            while totalRead < contentLength {
                let n = bodyBuffer.withUnsafeMutableBufferPointer { ptr in
                    read(fd, ptr.baseAddress! + totalRead, contentLength - totalRead)
                }
                guard n > 0 else { break }
                totalRead += n
            }
            body = String(bytes: bodyBuffer[0..<totalRead], encoding: .utf8) ?? ""
        }

        return (method, path, accept, body)
    }

    private func sendResponse(_ fd: Int32, status: String, body: String, contentType: String = "application/json") {
        // Write header (ASCII) and body (UTF-8) separately: withCString/strlen
        // would truncate a body containing embedded NULs and mis-measure
        // multibyte UTF-8. The skill markdown is large and non-ASCII, so send
        // the exact byte count.
        let bodyBytes = Array(body.utf8)
        let header = "HTTP/1.1 \(status)\r\nContent-Type: \(contentType)\r\nContent-Length: \(bodyBytes.count)\r\nConnection: close\r\nAccess-Control-Allow-Origin: *\r\n\r\n"
        var out = Array(header.utf8)
        out.append(contentsOf: bodyBytes)
        var offset = 0
        out.withUnsafeBytes { buf in
            while offset < buf.count {
                let n = write(fd, buf.baseAddress!.advanced(by: offset), buf.count - offset)
                if n <= 0 { break }
                offset += n
            }
        }
    }

    /// Decode a base64 build-time constant, or "" if empty/corrupt.
    private func decodeSkillB64(_ b64: String) -> String {
        guard !b64.isEmpty, let data = Data(base64Encoded: b64),
              let text = String(data: data, encoding: .utf8) else { return "" }
        return text
    }

    /// GET / and /skill: the protocol manual + the three clients inlined.
    /// Human clients get raw markdown; tools get JSON {skill, clients:{…}}.
    private func sendSkill(_ fd: Int32, wantsHuman: Bool) {
        let skill = decodeSkillB64(DebugSkillGenerated.skillMarkdownB64)
        guard !skill.isEmpty else {
            sendResponse(fd, status: "503 Service Unavailable",
                         body: #"{"error":"skill not embedded in this build"}"#)
            return
        }
        if wantsHuman {
            sendResponse(fd, status: "200 OK", body: skill, contentType: "text/markdown; charset=utf-8")
            return
        }
        let payload: [String: Any] = [
            "skill": skill,
            "clients": [
                "python": decodeSkillB64(DebugSkillGenerated.clientPythonB64),
                "node": decodeSkillB64(DebugSkillGenerated.clientNodeB64),
                "bash": decodeSkillB64(DebugSkillGenerated.clientBashB64),
            ],
            "client_paths": [
                "python": "/skill/examples/python",
                "node": "/skill/examples/node",
                "bash": "/skill/examples/bash",
            ],
        ]
        let data = (try? JSONSerialization.data(withJSONObject: payload, options: .withoutEscapingSlashes)) ?? Data("{}".utf8)
        sendResponse(fd, status: "200 OK", body: String(data: data, encoding: .utf8) ?? "{}")
    }

    private func sendSkillClient(_ fd: Int32, base64: String, contentType: String) {
        let source = decodeSkillB64(base64)
        guard !source.isEmpty else {
            sendResponse(fd, status: "503 Service Unavailable",
                         body: #"{"error":"client not embedded in this build"}"#)
            return
        }
        sendResponse(fd, status: "200 OK", body: source, contentType: contentType)
    }

    private func errorJSON(_ code: Int, _ message: String, _ id: Any?) -> String {
        return """
        {"jsonrpc":"2.0","id":null,"error":{"code":\(code),"message":"\(message)"}}
        """
    }
}
#endif
