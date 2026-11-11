# Online Shell: prompt + command log. Sourced LAST by /etc/oshell/rc.sh so
# the default ~/.bashrc cannot override PS1 / PROMPT_COMMAND.
case $- in *i*) ;; *) return ;; esac

PS1='\[\e[1;32m\]\u@oshell\[\e[0m\]:\[\e[1;34m\]\w\[\e[0m\]\$ '
HISTCONTROL=ignoredups
HISTTIMEFORMAT='%F %T '
shopt -s histappend

# Append "<epoch>\t<exit>\t<cwd>\t<command>" per command to /run/oshell/cmd.log.
# The runner tails this file to fill CommandLog. (Students can tamper with it;
# it is a learning aid, not an audit log.)
__oshell_log() {
  local ec=$? line
  line=$(HISTTIMEFORMAT= history 1 | sed -E 's/^ *[0-9]+ +//')
  if [ -n "$line" ] && [ "$line" != "$__OSHELL_LAST" ]; then
    __OSHELL_LAST=$line
    printf '%s\t%s\t%s\t%s\n' "$(date +%s)" "$ec" "$PWD" "$line" >> /run/oshell/cmd.log 2>/dev/null
  fi
  return $ec
}
PROMPT_COMMAND="__oshell_log${PROMPT_COMMAND:+;$PROMPT_COMMAND}"
