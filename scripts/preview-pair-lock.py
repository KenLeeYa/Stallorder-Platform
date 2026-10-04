"""Hold a local OS lock until the owning Node process closes stdin.

Never unlink the lock file: every contender must lock the same inode.
No age-based stealing or live/provider operations.
"""
import errno
import os
import stat
import sys


def main():
    if len(sys.argv) != 2:
        return 1
    fd = os.open(sys.argv[1], os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            return 1
        if os.name == "nt":
            import msvcrt
            if os.fstat(fd).st_size == 0:
                os.write(fd, b"0")
            os.lseek(fd, 0, os.SEEK_SET)
            try:
                msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
            except OSError as error:
                return 75 if error.errno in (errno.EACCES, errno.EAGAIN, errno.EDEADLK) else 1
        else:
            import fcntl
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                return 75
        print("LOCKED", flush=True)
        # EOF arrives even on SIGKILL of the Node owner; no stale PID/TTL guess.
        sys.stdin.buffer.read()
        return 0
    finally:
        os.close(fd)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        sys.exit(1)
