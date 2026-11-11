# rcfile for the interactive shell the runner starts:
#   bash --rcfile /etc/oshell/rc.sh -i
[ -f /etc/bash.bashrc ] && . /etc/bash.bashrc
[ -f "$HOME/.bashrc" ] && . "$HOME/.bashrc"
. /etc/oshell/hooks.sh
