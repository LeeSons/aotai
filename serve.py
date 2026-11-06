# 本地开发服务器：禁止浏览器缓存，保证每次刷新都加载最新代码
# 用法：python3 serve.py   然后打开 http://localhost:5173
import http.server
import os
import socketserver

os.chdir(os.path.dirname(os.path.abspath(__file__)))


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, *args):
        pass


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == '__main__':
    with Server(('127.0.0.1', 5173), NoCacheHandler) as httpd:
        print('鳌太 · 九死一生  →  http://localhost:5173')
        httpd.serve_forever()
