# Student box for Bash exercises.
# The runner starts it with: no network (a step with internet access
# connects it to the internet network for a while), read-only rootfs,
# tmpfs /tmp + /run, a per-student volume at /home/student, dropped caps, no-new-privileges.
FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive LANG=C.UTF-8 TERM=xterm-256color

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      bash bash-completion coreutils findutils grep sed gawk diffutils \
      less nano vim-tiny tree jq file procps psmisc bc zip unzip tar gzip \
      man-db manpages ca-certificates git \
      wget curl iputils-ping dnsutils netcat-openbsd \
 && rm -rf /var/lib/apt/lists/*

# Git defaults for the lessons: `main` as first branch, nano instead of vi
# for commit/merge messages, merge on pull (no "divergent branches" error).
# No global safe.directory: root check scripts use oshell-git (below) for
# student-owned repos, never plain git.
RUN git config --system init.defaultBranch main \
 && git config --system core.editor nano \
 && git config --system pull.rebase false

COPY --chmod=755 oshell-git /usr/local/bin/oshell-git

# Non-root student user (uid 1000). Home is replaced by the per-student
# volume; Docker copies this image's /home/student into a NEW empty volume,
# so these dotfiles are the defaults on first start.
RUN useradd --create-home --uid 1000 --shell /bin/bash student \
 && mkdir -p /home/student/exercises \
 && chown -R student:student /home/student

COPY oshell-hooks.sh /etc/oshell/hooks.sh
COPY rc.sh /etc/oshell/rc.sh

WORKDIR /home/student
USER student
CMD ["sleep", "infinity"]
