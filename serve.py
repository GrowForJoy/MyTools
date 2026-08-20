import http.server, os, sys, mimetypes

os.chdir(os.path.dirname(os.path.abspath(__file__)))

mimetypes.add_type('text/javascript', '.js')
mimetypes.add_type('application/json', '.json')
mimetypes.add_type('application/wasm', '.wasm')
mimetypes.add_type('application/octet-stream', '.bin')
mimetypes.add_type('model/tflite', '.tflite')
mimetypes.add_type('image/png', '.png')
mimetypes.add_type('image/jpeg', '.jpg')

class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write('%s %s\n' % (self.address_string(), fmt % args))

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
http.server.ThreadingHTTPServer(('0.0.0.0', port), H).serve_forever()