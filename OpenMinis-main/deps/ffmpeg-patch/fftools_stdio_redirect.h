/*
 * fftools_stdio_redirect.h
 *
 * Thread-local stdio redirection for fftools.
 *
 * When force-included (-include) into every fftools .c file, the macros
 * below transparently redirect fprintf/printf/fputs/vfprintf calls that
 * target stdout or stderr to a per-thread pipe fd instead of the process-
 * global file descriptors.  This avoids dup2() which would hijack ALL
 * iOS output (NSLog, os_log, etc.) during an ffmpeg run.
 */

#ifndef FFTOOLS_STDIO_REDIRECT_H
#define FFTOOLS_STDIO_REDIRECT_H

#include <stdio.h>
#include <stdarg.h>

/* ── Thread-local target fds ── */
/* -1 means "use the real stdio function" (passthrough). */
extern _Thread_local int noff_stdout_fd;
extern _Thread_local int noff_stderr_fd;

/* ── Replacement functions ── */
int  noff_fprintf(FILE *stream, const char *fmt, ...)
        __attribute__((__format__(__printf__, 2, 3)));
int  noff_printf(const char *fmt, ...)
        __attribute__((__format__(__printf__, 1, 2)));
int  noff_fputs(const char *s, FILE *stream);
int  noff_vfprintf(FILE *stream, const char *fmt, va_list ap);

/* ── av_log redirect helpers ── */
/* These live here (compiled inside the framework) so the app binary
   does not need to link directly against libavutil's av_log symbols. */
void noff_av_log_redirect_start(void);   /* set custom av_log callback */
void noff_av_log_redirect_stop(void);    /* restore default callback   */

/* ── Macro overrides ── */
/* These must come AFTER the real <stdio.h> has been included so that the
   original declarations are visible to the replacement implementations. */
#define fprintf  noff_fprintf
#define printf   noff_printf
#define fputs    noff_fputs
#define vfprintf noff_vfprintf

#endif /* FFTOOLS_STDIO_REDIRECT_H */
