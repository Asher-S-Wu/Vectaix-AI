/*
 * fftools_stdio_redirect.c
 *
 * Implementation of thread-local stdio redirection for fftools.
 * See fftools_stdio_redirect.h for the full picture.
 *
 * IMPORTANT: This file must be compiled WITHOUT the -include flag that
 * applies the macro overrides, otherwise our own implementations would
 * recursively call themselves.  build_ffmpeg.sh compiles this file
 * separately for that reason.
 */

#include <stdio.h>
#include <stdarg.h>
#include <string.h>
#include <unistd.h>
#include "libavutil/log.h"

/* ── Thread-local target fds ── */
_Thread_local int noff_stdout_fd = -1;
_Thread_local int noff_stderr_fd = -1;

/* ── Helpers ── */

/* Return the thread-local fd for a given stream, or -1 if passthrough. */
static inline int fd_for_stream(FILE *stream) {
    if (stream == stdout && noff_stdout_fd >= 0) return noff_stdout_fd;
    if (stream == stderr && noff_stderr_fd >= 0) return noff_stderr_fd;
    return -1;
}

/* ── Replacement functions ── */

int noff_vfprintf(FILE *stream, const char *fmt, va_list ap) {
    int fd = fd_for_stream(stream);
    if (fd < 0) {
        return vfprintf(stream, fmt, ap);
    }
    return vdprintf(fd, fmt, ap);
}

int noff_fprintf(FILE *stream, const char *fmt, ...) {
    va_list ap;
    va_start(ap, fmt);
    int ret = noff_vfprintf(stream, fmt, ap);
    va_end(ap);
    return ret;
}

int noff_printf(const char *fmt, ...) {
    va_list ap;
    va_start(ap, fmt);
    int ret = noff_vfprintf(stdout, fmt, ap);
    va_end(ap);
    return ret;
}

int noff_fputs(const char *s, FILE *stream) {
    int fd = fd_for_stream(stream);
    if (fd < 0) {
        return fputs(s, stream);
    }
    size_t len = strlen(s);
    ssize_t written = write(fd, s, len);
    return (written >= 0) ? (int)written : EOF;
}

/* ── av_log redirect ── */

static void noff_av_log_callback(void *ptr, int level, const char *fmt, va_list vl) {
    if (level > av_log_get_level()) return;

    int target_fd = noff_stderr_fd;
    if (target_fd < 0) {
        av_log_default_callback(ptr, level, fmt, vl);
        return;
    }

    char line[1024];
    int print_prefix = 1;
    av_log_format_line(ptr, level, fmt, vl, line, sizeof(line), &print_prefix);
    size_t len = strlen(line);
    if (len > 0) {
        write(target_fd, line, len);
    }
}

void noff_av_log_redirect_start(void) {
    av_log_set_callback(noff_av_log_callback);
}

void noff_av_log_redirect_stop(void) {
    av_log_set_callback(av_log_default_callback);
}
