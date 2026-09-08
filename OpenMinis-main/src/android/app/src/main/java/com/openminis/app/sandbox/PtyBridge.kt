package com.openminis.app.sandbox

/**
 * JNI bridge to bionic libc's forkpty() + termios + waitpid.
 *
 * Enables a real TTY for the spawned proot/sh process so readline, PS1 prompt,
 * arrow keys, Ctrl+C (SIGINT) and interactive programs (vi, top, gh auth login)
 * all work — mirroring iOS ISHKernel behaviour. Without this, Android would
 * only have line-buffered stdin/stdout via ProcessBuilder, which is fundamentally
 * different from a TTY and breaks every interactive program.
 */
object PtyBridge {
    init {
        System.loadLibrary("pty_bridge")
    }

    /**
     * Fork a child process attached to a new PTY and execve() into [cmd].
     *
     * @param cmd   absolute path to the executable (e.g. /data/data/.../libproot.so)
     * @param argv  argv[0] is conventionally the command name; include it
     * @param envp  environment strings in "KEY=VALUE" form
     * @param cwd   working directory for the child (or null)
     * @param cols  initial terminal columns
     * @param rows  initial terminal rows
     * @param outPid single-element int array receiving the child pid
     * @return PTY master fd on success, or -errno on failure
     */
    @JvmStatic
    external fun forkExec(
        cmd: String,
        argv: Array<String>,
        envp: Array<String>,
        cwd: String?,
        cols: Int,
        rows: Int,
        outPid: IntArray
    ): Int

    /** Read from PTY master. Returns bytes read, 0 on EOF, or -errno. */
    @JvmStatic
    external fun readBytes(fd: Int, buf: ByteArray, off: Int, len: Int): Int

    /** Write to PTY master. Returns bytes written, or -errno. Blocks until all len bytes are written. */
    @JvmStatic
    external fun writeBytes(fd: Int, buf: ByteArray, off: Int, len: Int): Int

    /** ioctl(TIOCSWINSZ). Returns 0 or -errno. */
    @JvmStatic
    external fun setWindowSize(fd: Int, cols: Int, rows: Int): Int

    /** Close the PTY master fd. Returns 0 or -errno. */
    @JvmStatic
    external fun closeFd(fd: Int): Int

    /** kill(pid, sig). Returns 0 or -errno. */
    @JvmStatic
    external fun sendSignal(pid: Int, sig: Int): Int

    /**
     * waitpid(pid, &status, 0). Blocks.
     * Returns WEXITSTATUS on normal exit, -(128+sig) on signal, -errno on failure.
     */
    @JvmStatic
    external fun waitFor(pid: Int): Int
}
