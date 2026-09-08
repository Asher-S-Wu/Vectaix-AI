package com.openminis.app.ui.settings

import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Apps
import androidx.compose.material.icons.filled.Dns
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Fullscreen
import androidx.compose.material.icons.filled.Launch
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PhoneAndroid
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.TouchApp
import androidx.compose.material.icons.filled.Wifi
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.openminis.app.R
import com.openminis.app.offload.ShizukuBackend
import com.openminis.app.offload.ShizukuManager

/**
 * T322 / [T-android-privileged-backend]: state-driven Shizuku-protocol
 * permission walkthrough.
 *
 * Renders a single section whose body changes based on
 * [ShizukuManager.snapshot]:
 *
 *   NOT_INSTALLED     → THREE install CTAs (Shizuku / AXManager / Sui). All
 *                        speak the same protocol — the user picks whichever
 *                        suits them; Sui is the rooted-user option.
 *   NOT_RUNNING       → "Open Manager App and press Start" — launches the
 *                        installed manager.
 *   NEED_PERMISSION   → "Authorize Minis" CTA → triggers system dialog.
 *   READY             → green status row with version + uid.
 *
 * [T-android-sui-support] (GH#110 / GH#97) Sui is a Magisk/KernelSU module
 * with no APK and no launcher activity, so on a Sui-supplied binder the
 * "Open Manager App" rows are hidden — there is nothing to open — and the
 * READY row is labelled "Sui (root)".
 */
@Composable
fun ShizukuPermissionScreen(onBack: () -> Unit) {
    val context = LocalContext.current
    val snap by ShizukuManager.snapshot.collectAsState()

    LaunchedEffect(Unit) { ShizukuManager.refresh() }

    SettingsScaffold(
        title = stringResource(R.string.shizuku_title),
        onBack = onBack,
    ) {
        SettingsSection(
            header = stringResource(R.string.shizuku_status_header),
            footer = stringResource(R.string.shizuku_status_footer),
        ) {
            SettingsRow(
                title = stringResource(stateTitle(snap.state)),
                subtitle = if (snap.state == ShizukuManager.State.READY) {
                    // [T-android-sui-support] Name the live provider so a Sui
                    // user can see their root module is what's serving Minis.
                    if (snap.isSui) {
                        stringResource(R.string.shizuku_ready_subtitle_sui, snap.version, snap.uid)
                    } else {
                        stringResource(R.string.shizuku_ready_subtitle, snap.version, snap.uid)
                    }
                } else {
                    stringResource(stateSubtitle(snap.state))
                },
                trailing = {
                    Text(
                        text = stringResource(stateBadge(snap.state)),
                        style = MaterialTheme.typography.labelMedium,
                        color = stateColor(snap.state),
                    )
                },
                showDivider = false,
            )
        }

        when (snap.state) {
            // Two parallel install entries — Shizuku and AXManager are
            // functionally equivalent; the user picks whichever they like.
            // Both go to the project's GitHub Releases page (no Play Store —
            // AXManager isn't published there, and a single source per manager
            // keeps the option set symmetrical).
            ShizukuManager.State.NOT_INSTALLED -> SettingsSection(
                header = stringResource(R.string.shizuku_actions_header),
                footer = stringResource(R.string.shizuku_install_footer),
            ) {
                SettingsRow(
                    title = stringResource(R.string.shizuku_install_btn),
                    subtitle = stringResource(R.string.shizuku_install_btn_subtitle),
                    onClick = { ShizukuManager.openInstallPage(context, ShizukuBackend.SHIZUKU_GITHUB_URL) },
                )
                SettingsRow(
                    title = stringResource(R.string.shizuku_install_btn_axmanager),
                    subtitle = stringResource(R.string.shizuku_install_btn_axmanager_subtitle),
                    onClick = { ShizukuManager.openInstallPage(context, ShizukuBackend.AXMANAGER_GITHUB_URL) },
                )
                // [T-android-sui-support] Third option for rooted users: Sui
                // needs no APK and survives reboots, so it is strictly nicer
                // than Shizuku IF the user already runs Magisk/KernelSU.
                SettingsRow(
                    title = stringResource(R.string.shizuku_install_btn_sui),
                    subtitle = stringResource(R.string.shizuku_install_btn_sui_subtitle),
                    onClick = { ShizukuManager.openInstallPage(context, ShizukuBackend.SUI_GITHUB_URL) },
                    showDivider = false,
                )
            }

            ShizukuManager.State.NOT_RUNNING -> SettingsSection(
                header = stringResource(R.string.shizuku_actions_header),
                footer = stringResource(R.string.shizuku_start_footer),
            ) {
                SettingsRow(
                    title = stringResource(R.string.shizuku_open_btn),
                    subtitle = stringResource(R.string.shizuku_open_btn_subtitle),
                    onClick = { ShizukuManager.openShizukuApp(context) },
                )
                SettingsRow(
                    title = stringResource(R.string.shizuku_recheck_btn),
                    subtitle = stringResource(R.string.shizuku_recheck_subtitle),
                    onClick = { ShizukuManager.refresh() },
                    showDivider = false,
                )
            }

            ShizukuManager.State.NEED_PERMISSION -> SettingsSection(
                header = stringResource(R.string.shizuku_actions_header),
                footer = stringResource(
                    if (snap.isSui) R.string.shizuku_grant_footer_sui
                    else R.string.shizuku_grant_footer,
                ),
            ) {
                SettingsRow(
                    title = stringResource(R.string.shizuku_grant_btn),
                    subtitle = stringResource(R.string.shizuku_grant_subtitle),
                    onClick = { ShizukuManager.requestPermission() },
                    // Sui has no manager activity, so this is the only row.
                    showDivider = !snap.isSui,
                )
                if (!snap.isSui) {
                    SettingsRow(
                        title = stringResource(R.string.shizuku_open_btn),
                        subtitle = stringResource(R.string.shizuku_open_btn_subtitle),
                        onClick = { ShizukuManager.openShizukuApp(context) },
                        showDivider = false,
                    )
                }
            }

            // [T-android-sui-capabilities-not-empty] READY renders the actual
            // capability LIST, one row per android-shizuku-cli subcommand.
            //
            // This section used to be just a header + a static footer paragraph
            // enumerating the subcommands as prose, plus (Shizuku only) an "open
            // app" row. On Sui — which has no launcher activity, so that row is
            // hidden — the whole section collapsed to header + gray footer, and
            // users read that as "empty capabilities" (Sanite&Ava's report,
            // status badge read fine: Sui(root) v=13 uid=0). It was NEVER a
            // detection bug: the surface is compile-time-fixed and identical for
            // Shizuku / AXManager / Sui, so a static list is the correct model.
            // Now it renders as a real list on every provider.
            ShizukuManager.State.READY -> SettingsSection(
                header = stringResource(R.string.shizuku_capabilities_header),
                footer = stringResource(R.string.shizuku_capabilities_footer),
            ) {
                // Sui has no manager app to open, so that row stays hidden — but
                // the list below is now the section's content regardless.
                if (!snap.isSui) {
                    SettingsRow(
                        title = stringResource(R.string.shizuku_open_btn),
                        subtitle = stringResource(R.string.shizuku_open_btn_subtitle),
                        onClick = { ShizukuManager.openShizukuApp(context) },
                    )
                }
                ShizukuCapabilities.forEachIndexed { index, cap ->
                    SettingsRow(
                        // Subcommand name is a literal CLI token — not localized;
                        // only the human description is.
                        title = cap.name,
                        subtitle = stringResource(cap.descriptionRes),
                        icon = cap.icon,
                        // No divider after the last capability row.
                        showDivider = index != ShizukuCapabilities.lastIndex,
                        minHeight = 72.dp,
                    )
                }
            }
        }
        Spacer(Modifier.height(16.dp))
    }
}

private fun stateTitle(s: ShizukuManager.State): Int = when (s) {
    ShizukuManager.State.NOT_INSTALLED -> R.string.shizuku_state_not_installed
    ShizukuManager.State.NOT_RUNNING -> R.string.shizuku_state_not_running
    ShizukuManager.State.NEED_PERMISSION -> R.string.shizuku_state_need_permission
    ShizukuManager.State.READY -> R.string.shizuku_state_ready
}

private fun stateSubtitle(s: ShizukuManager.State): Int = when (s) {
    ShizukuManager.State.NOT_INSTALLED -> R.string.shizuku_state_not_installed_subtitle
    ShizukuManager.State.NOT_RUNNING -> R.string.shizuku_state_not_running_subtitle
    ShizukuManager.State.NEED_PERMISSION -> R.string.shizuku_state_need_permission_subtitle
    ShizukuManager.State.READY -> R.string.shizuku_state_ready
}

private fun stateBadge(s: ShizukuManager.State): Int = when (s) {
    ShizukuManager.State.NOT_INSTALLED -> R.string.shizuku_badge_not_installed
    ShizukuManager.State.NOT_RUNNING -> R.string.shizuku_badge_not_running
    ShizukuManager.State.NEED_PERMISSION -> R.string.shizuku_badge_need_permission
    ShizukuManager.State.READY -> R.string.shizuku_badge_ready
}

@Composable
private fun stateColor(s: ShizukuManager.State): Color = when (s) {
    ShizukuManager.State.READY -> MaterialTheme.colorScheme.primary
    ShizukuManager.State.NEED_PERMISSION -> MaterialTheme.colorScheme.tertiary
    ShizukuManager.State.NOT_RUNNING -> MaterialTheme.colorScheme.tertiary
    ShizukuManager.State.NOT_INSTALLED -> MaterialTheme.colorScheme.error
}

/**
 * [T-android-sui-capabilities-not-empty] One android-shizuku-cli subcommand.
 * The list is static: the CLI's command surface is fixed at compile time and
 * identical across Shizuku / AXManager / Sui, so no runtime probing is
 * appropriate. Icons are indicative only; the CLI token in [name] is the
 * source of truth and is never localized.
 */
private data class ShizukuCapability(
    val name: String,
    @androidx.annotation.StringRes val descriptionRes: Int,
    val icon: androidx.compose.ui.graphics.vector.ImageVector,
)

private val ShizukuCapabilities: List<ShizukuCapability> = listOf(
    ShizukuCapability("package", R.string.shizuku_cap_package_desc, Icons.Default.Apps),
    ShizukuCapability("permission", R.string.shizuku_cap_permission_desc, Icons.Default.Lock),
    ShizukuCapability("activity", R.string.shizuku_cap_activity_desc, Icons.Default.Launch),
    ShizukuCapability("display", R.string.shizuku_cap_display_desc, Icons.Default.Fullscreen),
    ShizukuCapability("settings", R.string.shizuku_cap_settings_desc, Icons.Default.Settings),
    ShizukuCapability("user", R.string.shizuku_cap_user_desc, Icons.Default.Person),
    ShizukuCapability("network", R.string.shizuku_cap_network_desc, Icons.Default.Wifi),
    ShizukuCapability("input", R.string.shizuku_cap_input_desc, Icons.Default.TouchApp),
    ShizukuCapability("notification", R.string.shizuku_cap_notification_desc, Icons.Default.Notifications),
    ShizukuCapability("file", R.string.shizuku_cap_file_desc, Icons.Default.Folder),
    ShizukuCapability("device", R.string.shizuku_cap_device_desc, Icons.Default.PhoneAndroid),
    ShizukuCapability("service", R.string.shizuku_cap_service_desc, Icons.Default.Dns),
)
