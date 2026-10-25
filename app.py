"""CanSat ground station as a desktop app:  python app.py  [--port 8000] [--xbee COMx] [--lora COMx]

Runs server.py in this process and shows the GUI in a native window (Edge WebView2 via pywebview).
COM ports are picked from the selectors in the GUI; CAMERA opens a second window.
"""
import sys, threading, webview
import server


class Api:                                                       # window.pywebview.api in the page
    def camera(self):
        webview.create_window("CanSat 26 - Camera", f"{URL}camera.html", width=1400, height=800)


args = server.parse_args()
httpd = server.start(args)
threading.Thread(target=httpd.serve_forever, daemon=True).start()
URL = f"http://localhost:{args.port}/"
print(f"GUI: {URL}index.html?src=xbee   (close the window to stop)")
webview.create_window("CanSat 26 Ground Station", f"{URL}index.html?src=xbee", js_api=Api(),
                      width=1600, height=900, maximized=True)
webview.start()
