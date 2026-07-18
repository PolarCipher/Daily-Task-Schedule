#!/bin/bash
# Always serves this app on the SAME port (8080), from THIS folder.
# Browsers store saved data (localStorage) per exact URL — including the
# port number. If the port changes between visits, the browser treats it
# as a totally different app with no saved data. Using this script every
# time keeps the URL identical, so your tasks are always there.

PORT=8080

# cd into the folder this script lives in, no matter where you run it from.
cd "$(dirname "$0")"

echo "Daily Task Scheduler running at: http://localhost:$PORT"
echo "(Press Ctrl+C to stop)"

python3 -m http.server "$PORT"
