const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = Number(process.env.ATTENDANCE_BRIDGE_PORT || 3000);
const HOST = String(process.env.ATTENDANCE_BRIDGE_HOST || '0.0.0.0').trim();
const DEFAULT_TARGET = 'https://us-central1-plataformaescolar-e0090.cloudfunctions.net/attendanceDevicePush?token=cc292d3a218d96afb8c1658bd81091d5307a';
const TARGET_URL = String(process.env.ATTENDANCE_BRIDGE_TARGET || DEFAULT_TARGET).trim();
const LOG_DIR = path.join(process.cwd(), 'logs');
const LOG_FILE = path.join(LOG_DIR, 'attendance-device-bridge.log');

function ensureLogDir() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function logLine(message, extra = '') {
  ensureLogDir();
  const line = `[${new Date().toISOString()}] ${message}${extra ? ` ${extra}` : ''}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, `${line}\n`);
}

function getLocalIpv4List() {
  const interfaces = os.networkInterfaces();
  const values = [];
  Object.values(interfaces).forEach((items) => {
    (items || []).forEach((item) => {
      if (item && item.family === 'IPv4' && !item.internal) {
        values.push(item.address);
      }
    });
  });
  return values;
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function buildTargetUrl(req) {
  const incomingUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const target = new URL(TARGET_URL);

  incomingUrl.searchParams.forEach((value, key) => {
    target.searchParams.set(key, value);
  });

  return target;
}

function shouldForwardRequest(req) {
  const incomingUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const normalizedPath = String(incomingUrl.pathname || '/').trim().toLowerCase();

  if (normalizedPath === '/health') return false;
  if (normalizedPath.includes('/note/insertnote')) return true;
  return normalizedPath === '/attendancedevicepush';
}

function writeJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  if (req.url === '/health') {
    writeJson(res, 200, { ok: true, target: TARGET_URL });
    return;
  }

  if (!shouldForwardRequest(req)) {
    logLine(`Ignored ${req.method || 'GET'} ${req.url || '/'}`, 'reason=non-attendance-route');
    writeJson(res, 202, { ok: true, ignored: true });
    return;
  }

  try {
    const bodyBuffer = await readRequestBody(req);
    const targetUrl = buildTargetUrl(req);
    const client = targetUrl.protocol === 'https:' ? https : http;

    const headers = {
      'Content-Type': req.headers['content-type'] || 'application/json',
      'User-Agent': req.headers['user-agent'] || 'attendance-device-bridge',
      'x-device-route': req.url || '/',
    };

    if (bodyBuffer.length > 0) {
      headers['Content-Length'] = bodyBuffer.length;
    }

    const proxyRequest = client.request(targetUrl, {
      method: req.method || 'GET',
      headers,
    }, (proxyResponse) => {
      const chunks = [];
      proxyResponse.on('data', (chunk) => chunks.push(chunk));
      proxyResponse.on('end', () => {
        const responseBody = Buffer.concat(chunks);
        logLine(
          `Forwarded ${req.method || 'GET'} ${req.url || '/'} -> ${targetUrl.toString()}`,
          `status=${proxyResponse.statusCode || 0}`,
        );

        res.writeHead(proxyResponse.statusCode || 502, {
          'Content-Type': proxyResponse.headers['content-type'] || 'application/json',
        });
        res.end(responseBody);
      });
    });

    proxyRequest.on('error', (error) => {
      logLine(`Proxy error for ${req.method || 'GET'} ${req.url || '/'}`, error.message || 'unknown');
      writeJson(res, 502, {
        ok: false,
        message: 'No fue posible reenviar la solicitud al endpoint publicado.',
        error: error.message || 'unknown',
      });
    });

    if (bodyBuffer.length > 0) {
      proxyRequest.write(bodyBuffer);
    }
    proxyRequest.end();
  } catch (error) {
    logLine(`Bridge error for ${req.method || 'GET'} ${req.url || '/'}`, error.message || 'unknown');
    writeJson(res, 500, {
      ok: false,
      message: 'Fallo interno del puente local.',
      error: error.message || 'unknown',
    });
  }
});

server.listen(PORT, HOST, () => {
  const ipList = getLocalIpv4List();
  logLine(`Attendance bridge listening on http://${HOST}:${PORT}`);
  logLine(`Target endpoint: ${TARGET_URL}`);
  if (ipList.length > 0) {
    logLine(`Local IPs: ${ipList.join(', ')}`);
  }
  logLine('Suggested device path: /attendanceDevicePush');
  logLine('Health check: /health');
});
