package com.openminis.app.ui.chat

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.openminis.app.R
import com.openminis.app.offload.OffloadPermissionManager
import com.openminis.app.ui.components.MinisButton
import com.openminis.app.ui.components.MinisOutlinedButton
import com.openminis.app.ui.components.MinisTextButton

/**
 * Dialog shown when an ASK_ONCE tool requests permission.
 *
 * T338: three session-scoped options. None of them ever upgrade the
 * stored PermissionLevel — to make a permanent change the user goes
 * to Settings → Permissions and picks Bypass / Not Allowed there.
 *
 *   • Allow in this session — grant for the remaining session, no
 *     more prompts for this tool until the session ends.
 *   • Allow once            — grant only this call; next call re-prompts.
 *   • Deny in this session  — refuse + remember, so the agent can't
 *     spam the same dialog after the user already said no.
 *
 * Dismissing via tap-outside or system back maps to DENY_SESSION too;
 * a silent dismiss should not invite the agent to keep retrying.
 */
@Composable
fun OffloadPermissionDialog() {
    val request by OffloadPermissionManager.pendingRequest.collectAsState()
    val req = request ?: return

    AlertDialog(
        onDismissRequest = {
            OffloadPermissionManager.respondToRequest(OffloadPermissionManager.Response.DENY_SESSION)
        },
        title = {
            Text(
                stringResource(R.string.offload_perm_dialog_title),
                fontWeight = FontWeight.Bold,
            )
        },
        text = {
            Column {
                Text(
                    stringResource(R.string.offload_perm_dialog_intro),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    req.toolTitle,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                )
                Spacer(Modifier.height(4.dp))
                Text(
                    stringResource(R.string.offload_perm_dialog_tool_label, req.toolName),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(12.dp))
                Text(
                    req.description,
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
        },
        confirmButton = {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 8.dp, vertical = 4.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                // Allow in this session — happy path goes first.
                MinisButton(
                    onClick = { OffloadPermissionManager.respondToRequest(OffloadPermissionManager.Response.ALLOW_SESSION) },
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(stringResource(R.string.offload_perm_allow_session))
                }
                // Allow once — no caching; next call re-prompts.
                MinisOutlinedButton(
                    onClick = { OffloadPermissionManager.respondToRequest(OffloadPermissionManager.Response.ALLOW_ONCE) },
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(stringResource(R.string.offload_perm_allow_once))
                }
                // Deny in this session — refuse + remember.
                MinisTextButton(
                    onClick = { OffloadPermissionManager.respondToRequest(OffloadPermissionManager.Response.DENY_SESSION) },
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.textButtonColors(
                        contentColor = MaterialTheme.colorScheme.error,
                    ),
                ) {
                    Text(stringResource(R.string.offload_perm_deny_session))
                }
            }
        },
        dismissButton = null,
    )
}
