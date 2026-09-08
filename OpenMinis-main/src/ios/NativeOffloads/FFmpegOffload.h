//
//  FFmpegOffload.h
//  MinisApp
//
//  Bridges FFmpeg.framework's ffmpeg_main() to iSH native offload,
//  so `ffmpeg` commands in the iSH shell execute natively via the
//  linked FFmpeg library with real-time stdio forwarding.
//

#ifndef FFmpegOffload_h
#define FFmpegOffload_h

/// Register the ffmpeg native handler with iSH's native offload system.
/// Call once after the kernel has booted (e.g. in ISHKernel.bootWithRootPath:).
/// Guest execve("/usr/bin/ffmpeg", ...) will be routed to FFmpeg.framework.
void ffmpeg_offload_register(void);

#endif /* FFmpegOffload_h */
