'use strict';

var colors = require('colors'),
  os = require('os'),
  httpServer = require('http-server'),
  fs = require('fs'),
  path = require('path'),
  portfinder = require('portfinder'),
  opener = require('opener'),
  director = require('director'),
  co = require('co'),
  Mock = require('./mock'),
  thunkify = require('thunkify'),
  argv = require('optimist')
  .boolean('cors')
  .argv;

var ifaces = os.networkInterfaces(),
  router = new director.http.Router();

if (argv.h || argv.help) {
  console.log([
    'usage: biz-server [path] [options]',
    '',
    'options:',
    '  -p           Port to use [8080]',
    '  -a           Address to use [0.0.0.0]',
    '  -d           Show directory listings [true]',
    '  -i           Display autoIndex [true]',
    '  -as --actionSuffix   be filterd ajax request suffix, comma separated  [.action]',
    '  -m --mock    mock config path  [cwd() + /config/mockConfig]',
    '  -e --ext     Default file extension if none supplied [none]',
    '  -s --silent  Suppress log messages from output',
    '  --cors[=headers]   Enable CORS via the "Access-Control-Allow-Origin" header',
    '                     Optionally provide CORS headers list separated by commas',
    '  -o [path]    Open browser window after starting the server',
    '  -c           Cache time (max-age) in seconds [3600], e.g. -c10 for 10 seconds.',
    '               To disable caching, use -c-1.',
    '  -U --utc     Use UTC time format in log messages.',
    '',
    '  -P --proxy   Fallback proxy if the request cannot be resolved. e.g.: http://someurl.com',
    '',
    '  -S --ssl     Enable https.',
    '  -C --cert    Path to ssl cert file (default: cert.pem).',
    '  -K --key     Path to ssl key file (default: key.pem).',
    '',
    '  -r --robots  Respond to /robots.txt [User-agent: *\\nDisallow: /]',
    '  -h --help    Print this list and exit.'
  ].join('\n'));
  process.exit();
}

var port = argv.p || parseInt(process.env.PORT, 10),
  host = argv.a || '0.0.0.0',
  ssl = !!argv.S || !!argv.ssl,
  proxy = argv.P || argv.proxy,
  utc = argv.U || argv.utc,
  as = argv.as || '.action',
  mockConfig = require(argv.m || process.cwd() + '/config/mockConfig.json'),
  logger;

if (!argv.s && !argv.silent) {
  logger = {
    info: console.log,
    request: function(req, res, error) {
      var date = utc ? new Date().toUTCString() : new Date();
      if (error) {
        logger.info(
          '[%s] "%s %s" Error (%s): "%s"',
          date, req.method.red, req.url.red,
          error.status.toString().red, error.message.red
        );
      } else {
        logger.info(
          '[%s] "%s %s" "%s"',
          date, req.method.cyan, req.url.cyan,
          req.headers['user-agent']
        );
      }
    }
  };
} else if (colors) {
  logger = {
    info: function() {},
    request: function() {}
  };
}

var mock = new Mock({
  as: as,
  mockConfig: mockConfig,
  logger: logger
})

if (!port) {
  portfinder.basePort = 8080;
  portfinder.getPort(function(err, port) {
    if (err) {
      throw err;
    }
    listen(port);
  });
} else {
  listen(port);
}

function listen(port) {
  var options = {
    root: argv._[0],
    cache: argv.c,
    showDir: argv.d,
    autoIndex: argv.i,
    robots: argv.r || argv.robots,
    ext: argv.e || argv.ext,
    logFn: logger.request,
    proxy: proxy,
    before: [
      function(req, res) {
        var found = mock.dispatch(req, res);
        if (!found) {
          res.emit('next');
        }
      }
    ]
  };

  if (argv.cors) {
    options.cors = true;
    if (typeof argv.cors === 'string') {
      options.corsHeaders = argv.cors;
    }
  }

  if (ssl) {
    options.https = {
      cert: argv.C || argv.cert || 'cert.pem',
      key: argv.K || argv.key || 'key.pem'
    };
  }

  var server = startBizServer(options);
  server.listen(port, host, function() {
    var canonicalHost = host === '0.0.0.0' ? '127.0.0.1' : host,
      protocol = ssl ? 'https:' : 'http:';

    logger.info(['Starting up http-server, serving '.yellow,
      server.root.cyan,
      ssl ? (' through'.yellow + ' https'.cyan) : '',
      '\nAvailable on:'.yellow
    ].join(''));

    Object.keys(ifaces).forEach(function(dev) {
      ifaces[dev].forEach(function(details) {
        if (details.family === 'IPv4') {
          logger.info(('  ' + protocol + details.address + ':' + port.toString()).green);
        }
      });
    });

    if (typeof proxy === 'string') {
      logger.info('Unhandled requests will be served from: ' + proxy);
    }

    logger.info('Hit CTRL-C to stop the server');
    if (argv.o) {
      opener(
        protocol + '//' + canonicalHost + ':' + port, {
          command: argv.o !== true ? argv.o : null
        }
      );
    }
  });
}

if (process.platform === 'win32') {
  require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
  }).on('SIGINT', function() {
    process.emit('SIGINT');
  });
}

process.on('SIGINT', function() {
  logger.info('http-server stopped.'.red);
  process.exit();
});

process.on('SIGTERM', function() {
  logger.info('http-server stopped.'.red);
  process.exit();
});

function startBizServer(options) {
  return httpServer.createServer(options || {});
}

exports.startBizServer = startBizServer