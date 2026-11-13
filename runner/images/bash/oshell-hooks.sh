# Online Shell: prompt + command log. Sourced LAST by /etc/oshell/rc.sh so
# the default ~/.bashrc cannot override PS1 / PROMPT_COMMAND.
case $- in *i*) ;; *) return ;; esac

PS1='\[\e[1;32m\]\u@oshell\[\e[0m\]:\[\e[1;34m\]\w\[\e[0m\]\$ '
HISTCONTROL=ignoredups
HISTTIMEFORMAT='%F %T '
shopt -s histappend

# Append "<epoch>\t<exit>\t<cwd>\t<command>" per command to /run/oshell/cmd.log
# (the web app ingests it into CommandLog) and print the same line as a private
# OSC sequence (ESC ] 7337 ; base64 BEL), which the runner strips from the
# output for the teacher's live view (runner/src/commands.ts). (Students can
# tamper with both; it is a learning aid, not an audit log.)
__oshell_log() {
  local ec=$? line rec
  line=$(HISTTIMEFORMAT= history 1 | sed -E 's/^ *[0-9]+ +//')
  if [ -n "$line" ] && [ "$line" != "$__OSHELL_LAST" ]; then
    __OSHELL_LAST=$line
    rec=$(printf '%s\t%s\t%s\t%s' "$(date +%s)" "$ec" "$PWD" "$line")
    printf '%s\n' "$rec" >> /run/oshell/cmd.log 2>/dev/null
    printf '\033]7337;%s\007' "$(printf '%s' "$rec" | base64 -w0)"
  fi
  return $ec
}
PROMPT_COMMAND="__oshell_log${PROMPT_COMMAND:+;$PROMPT_COMMAND}"
