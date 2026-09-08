package com.openminis.app.ui.sandbox

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.openminis.app.sandbox.RootfsInstallState
import com.openminis.app.sandbox.RootfsManager
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.io.File

data class RootfsManagementUiState(
    val isInstalled: Boolean = false,
    val isProcessing: Boolean = false,
    val statusMessage: String = "",
    val resultMessage: String? = null,
    val lastOperationSuccess: Boolean = false,
    val rootfsSize: Long = 0L,
    val rootfsPath: String = "",
    val hasBackup: Boolean = false,
    /** Current install phase + 0..1 progress (null when not installing). */
    val installProgress: Float? = null,
)

class RootfsManagementViewModel : ViewModel() {

    private val _uiState = MutableStateFlow(RootfsManagementUiState())
    val uiState: StateFlow<RootfsManagementUiState> = _uiState.asStateFlow()

    private var backupDir: File? = null
    private var progressJob: Job? = null

    /**
     * Subscribe to the manager's installState and mirror progress + status
     * text into [_uiState]. Cancelled on completion so we don't leak a job
     * across multiple install() calls.
     */
    private fun observeInstallProgress(manager: RootfsManager) {
        progressJob?.cancel()
        progressJob = viewModelScope.launch {
            manager.installState.collect { state ->
                when (state) {
                    is RootfsInstallState.Idle -> Unit
                    is RootfsInstallState.Preparing ->
                        _uiState.value = _uiState.value.copy(
                            statusMessage = "Preparing rootfs…",
                            installProgress = 0f,
                        )
                    is RootfsInstallState.Extracting ->
                        _uiState.value = _uiState.value.copy(
                            statusMessage = "Extracting rootfs… ${(state.progress * 100).toInt()}%",
                            installProgress = state.progress,
                        )
                    is RootfsInstallState.Finalizing ->
                        _uiState.value = _uiState.value.copy(
                            statusMessage = "Finalizing…",
                            installProgress = 1f,
                        )
                    is RootfsInstallState.Installed,
                    is RootfsInstallState.Failed -> {
                        _uiState.value = _uiState.value.copy(installProgress = null)
                        progressJob?.cancel()
                    }
                }
            }
        }
    }

    fun refresh(context: Context) {
        val manager = RootfsManager.getInstance(context)

        _uiState.value = _uiState.value.copy(
            isInstalled = manager.isInstalled,
            rootfsPath = manager.rootfsDir.absolutePath,
        )

        if (manager.isInstalled) {
            viewModelScope.launch {
                try {
                    val size = manager.getRootfsSize()
                    _uiState.value = _uiState.value.copy(rootfsSize = size)
                } catch (_: Exception) { }
            }
        }
    }

    fun install(context: Context) {
        _uiState.value = _uiState.value.copy(
            isProcessing = true,
            statusMessage = "Installing rootfs...",
            resultMessage = null,
            installProgress = 0f,
        )

        val manager = RootfsManager.getInstance(context)
        observeInstallProgress(manager)
        viewModelScope.launch {
            try {
                manager.installIfNeeded()
                _uiState.value = _uiState.value.copy(
                    isProcessing = false,
                    lastOperationSuccess = true,
                    resultMessage = "Rootfs installed successfully",
                    installProgress = null,
                )
                refresh(context)
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(
                    isProcessing = false,
                    lastOperationSuccess = false,
                    resultMessage = "Installation failed: ${e.message}",
                    installProgress = null,
                )
            }
        }
    }

    fun resetRootfs(context: Context, keepUserData: Boolean) {
        _uiState.value = _uiState.value.copy(
            isProcessing = true,
            statusMessage = if (keepUserData) "Backing up and resetting..." else "Resetting rootfs...",
            resultMessage = null,
            installProgress = 0f,
        )

        val manager = RootfsManager.getInstance(context)
        observeInstallProgress(manager)
        viewModelScope.launch {
            try {
                val backup = manager.reset(keepUserData)

                backupDir = backup
                _uiState.value = _uiState.value.copy(
                    isProcessing = false,
                    lastOperationSuccess = true,
                    hasBackup = backup != null && backup.exists(),
                    resultMessage = if (keepUserData) {
                        "Rootfs reset with backup created"
                    } else {
                        "Rootfs reset complete"
                    },
                    installProgress = null,
                )
                refresh(context)
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(
                    isProcessing = false,
                    lastOperationSuccess = false,
                    resultMessage = "Reset failed: ${e.message}",
                    installProgress = null,
                )
            }
        }
    }

    fun restoreBackup(context: Context) {
        val backup = backupDir
        if (backup == null || !backup.exists()) {
            _uiState.value = _uiState.value.copy(
                resultMessage = "No backup available",
                lastOperationSuccess = false,
            )
            return
        }

        _uiState.value = _uiState.value.copy(
            isProcessing = true,
            statusMessage = "Restoring user data...",
            resultMessage = null,
        )

        val manager = RootfsManager.getInstance(context)
        viewModelScope.launch {
            try {
                manager.restoreUserData(backup)

                backupDir = null
                _uiState.value = _uiState.value.copy(
                    isProcessing = false,
                    lastOperationSuccess = true,
                    hasBackup = false,
                    resultMessage = "User data restored successfully",
                )
                refresh(context)
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(
                    isProcessing = false,
                    lastOperationSuccess = false,
                    resultMessage = "Restore failed: ${e.message}",
                )
            }
        }
    }
}
