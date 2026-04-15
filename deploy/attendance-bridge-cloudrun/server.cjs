const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = Number(process.env.PORT || process.env.ATTENDANCE_BRIDGE_PORT || 8080);
const HOST = String(process.env.ATTENDANCE_BRIDGE_HOST || '0.0.0.0').trim();
const TARGET_BASE_URL = String(
  process.env.ATTENDANCE_BRIDGE_TARGET || 'https://us-central1-plataformaescolar-e0090.cloudfunctions.net/attendanceDevicePush',
).trim();
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

function parseIncomingRequest(req) {
  const rawUrl = String(req.url || '/').trim() || '/';
  const incomingUrl = new URL(rawUrl, `http://${req.headers.host || 'localhost'}`);
  const normalizedPath = String(incomingUrl.pathname || '/').trim().toLowerCase();
  const tokenWithSuffix = String(incomingUrl.searchParams.get('token') || '').trim();
  const slashIndex = tokenWithSuffix.indexOf('/');
  const normalizedToken = slashIndex >= 0 ? tokenWithSuffix.slice(0, slashIndex).trim() : tokenWithSuffix;
  const appendedRoute = slashIndex >= 0 ? `/${tokenWithSuffix.slice(slashIndex + 1).trim()}` : '';
  const forwardedRoute = appendedRoute || rawUrl;

  return {
    rawUrl,
    incomingUrl,
    normalizedPath,
    normalizedToken,
    forwardedRoute,
  };
}

function buildTargetUrl(parsedRequest) {
  const target = new URL(TARGET_BASE_URL);

  parsedRequest.incomingUrl.searchParams.forEach((value, key) => {
    target.searchParams.set(key, value);
  });
  if (parsedRequest.normalizedToken) {
    target.searchParams.set('token', parsedRequest.normalizedToken);
  }

  return target;
}

function shouldForwardRequest(parsedRequest) {
  if (parsedRequest.normalizedPath === '/health') return false;

  const forwardedRoute = String(parsedRequest.forwardedRoute || '').trim().toLowerCase();
  if (forwardedRoute.includes('/note/insertnote')) return true;
  return parsedRequest.normalizedPath === '/attendancedevicepush';
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
  const parsedRequest = parseIncomingRequest(req);

  if (req.url === '/health') {
    writeJson(res, 200, {
      ok: true,
      target: TARGET_BASE_URL,
      multitenant: true,
      tokenSource: 'request-query-or-body',
    });
    return;
  }

  if (!shouldForwardRequest(parsedRequest)) {
    logLine(`Ignored ${req.method || 'GET'} ${req.url || '/'}`, 'reason=non-attendance-route');
    writeJson(res, 202, { ok: true, ignored: true });
    return;
  }

  try {
    const bodyBuffer = await readRequestBody(req);
    const targetUrl = buildTargetUrl(parsedRequest);
    const client = targetUrl.protocol === 'https:' ? https : http;

    const headers = {
      'Content-Type': req.headers['content-type'] || 'application/json',
      'User-Agent': req.headers['user-agent'] || 'attendance-device-bridge',
      'x-device-route': parsedRequest.forwardedRoute || req.url || '/',
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
      message: 'Fallo interno del puente publicado.',
      error: error.message || 'unknown',
    });
  }
});

server.listen(PORT, HOST, () => {
  const ipList = getLocalIpv4List();
  logLine(`Attendance bridge listening on http://${HOST}:${PORT}`);
  logLine(`Target endpoint: ${TARGET_BASE_URL}`);
  if (ipList.length > 0) {
    logLine(`Local IPs: ${ipList.join(', ')}`);
  }
  logLine('Multitenant mode enabled', 'tenant=resolved-by-token-in-cloud-function');
  logLine('Suggested device path: /attendanceDevicePush');
  logLine('Health check: /health');
});
