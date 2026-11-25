#!/bin/zsh -f
# Open Screenshot Generator helper, version 1
#
# The Mac App Store version of Open Screenshot Generator runs in Apple's app
# sandbox, and every program it starts runs in there with it, where Claude Code
# and Codex can't see your sign-in. macOS runs the scripts you save in an app's
# own folder in ~/Library/Application Scripts outside the sandbox. The app uses
# this one to start Claude Code and Codex the way a terminal would, so they work
# with your own Claude or ChatGPT plan.
#
# The app can read this file but not change it. Delete it to take that back.
#
#   run <folder> -- <program> [argument...]
#       Starts the program in the folder. Standard input begins with changes to
#       the environment, one a line: NAME=value sets one, -NAME removes one, and
#       an empty line ends them. The rest of standard input is the program's.
#   signal <TERM|KILL> <pid or -group>
#       Stops a program this script started. The sandbox can't do that itself.

case $1 in
  (run)
    [[ $# -ge 4 && $3 == -- ]] || exit 64
    # exec keeps this pid, so it is the program's, and the app reads it here.
    print -u2 -r -- "osg-helper-pid $$"
    cd -- $2 || exit 126
    while IFS= read -r line && [[ -n $line ]]; do
      if [[ $line == -* ]]; then
        unset -- ${line#-}
      else
        export -- $line
      fi
    done
    unset line
    shift 3
    exec -- "$@"
    ;;
  (signal)
    [[ $# -eq 3 && $2 == (TERM|KILL) && $3 == (-|)<1-> ]] || exit 64
    kill -s $2 -- $3
    ;;
  (*)
    exit 64
    ;;
esac
