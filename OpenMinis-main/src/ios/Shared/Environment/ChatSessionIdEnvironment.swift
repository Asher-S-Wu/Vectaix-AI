//
//  ChatSessionIdEnvironment.swift
//  MinisApp
//
//  SwiftUI environment key used to propagate the current chat sessionId
//  down to nested tool sheets, media previews, and URL handlers that
//  need it but don't otherwise receive it through init parameters.
//

import SwiftUI

private struct ChatSessionIdKey: EnvironmentKey {
    static let defaultValue: String? = nil
}

extension EnvironmentValues {
    var chatSessionId: String? {
        get { self[ChatSessionIdKey.self] }
        set { self[ChatSessionIdKey.self] = newValue }
    }
}
