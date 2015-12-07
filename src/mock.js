'use strict';

require('colors');

var MockJs = require('mockjs'),
    extend = require('extend'),
    fs = require('fs'),
    fse = require('fs-extra'),
    path = require('path'),
    request = require('request'),
    director = require('director'),
    co = require('co'),
    thunkify = require('thunkify'),
    router = new director.http.Router();

var defaultOptions = {
    as: '.action',
    mockConfig: '/config/mockConfig.json',
    silent: false,
    methods: ['post', 'get'],
    port: 80
};

var logger = {
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

function Mock() {
    this.thunkGetJsonData = thunkify(this._getJsonData);
    this.thunkGetTemplateData = thunkify(this._getTemplateData);
    this.thunkGetCookieData = thunkify(this._getCookieData);
    this.thunkGetCustomData = thunkify(this._getCustomData);
}

Mock.prototype.start = function(options) {
    this.options = extend(true, defaultOptions, options || {});
    console.log(typeof this)
    this._initRouter();
    this.hasStart = true;
}

//init router
Mock.prototype._initRouter = function() {
    var as = this.options.as,
        mockConfig = this.options.mockConfig;
    //router action
    if (typeof as === 'string') {
        var suffix = as.split(',');
        for (var i = 0; i < suffix.length; i++) {
            var reg = '/(.*)' + suffix[i],
                me = this;

            function callback(url) {
                if (mockConfig) {
                    me._mockTo.call(me, url, this.req, this.res);
                }
            }
            for (var i = 0; i < this.options.methods.length; i++) {
                router[this.options.methods[i]].call(router, new RegExp(reg), callback);
            };
        }
    }
};

Mock.prototype.initFolder = function() {
    var src = path.join(__dirname, '../config');
    console.log('copy ' + src + ' to ' + process.cwd())
        // 复制目录
    fse.copy(src, process.cwd() + '/config', function(err) {
        if (err) {
            console.error(err);
        }
    });
    src = path.join(__dirname, '../mock');
    console.log('copy ' + src + ' to ' + process.cwd() + '/mock');
    // 复制目录
    fse.copy(src, process.cwd() + '/mock', function(err) {
        if (err) {
            console.error(err);
        }
    });
}

Mock.prototype.dispatch = function(req, res) {
    if (!this.hasStart) {
        logger.info('You first have to call mock.start()'.red)
    }
    return router.dispatch(req, res);
};

Mock.prototype._mockTo = function(url, req, res) {
    var me = this;
    co(function*() {
        for (var i = 0; i < me.options.mockConfig.dataSource.length; i++) {
            var method = me._getMockData(me.options.mockConfig.dataSource[i]);
            var data = yield method.call(me, me.options.mockConfig.dataSource[i], url, req, res);
            if (typeof data !== 'undefined') {
                res.writeHead(200, {
                    'Content-Type': 'application/json'
                });
                res.end(data);
                me.options.logger.request(req, res);
                break;
            } else if (!data && i === me.options.mockConfig.dataSource.length - 1) {
                //最后一个仍然没有返回数据，那么则返回404
                res.writeHead(404);
                res.end('not found');
                me.options.logger.info("Can't find any data source".red);
            }
        }
        me.options.logger.info('Datasource is ' + me.options.mockConfig.dataSource[i].green);
    }).catch(function(err) {
        res.writeHead(404);
        res.end(err.stack);
        me.options.logger.request(req, res, err);
    });
};

Mock.prototype._getMockData = function(type) {
    var method;
    switch (type) {
        case 'json':
            method = this.thunkGetJsonData;
            break;
        case 'template':
            method = this.thunkGetTemplateData;
            break;
        case 'cookie':
            method = this.thunkGetCookieData;
            break;
        default:
            method = this.thunkGetCustomData;
            break;
    }
    return method;
};


Mock.prototype._getJsonData = function(type, url, req, res, cb) {
    var pathStr = path.join(process.cwd(), this.options.mockConfig.json.path + url + (this.options.mockConfig.json.suffix || '.json'));
    this.options.logger.info('Json data path is ' + pathStr.cyan);
    if (fs.existsSync(pathStr)) {
        fs.readFile(pathStr, 'utf-8', function(err, data) {
            if (err) throw cb(err);
            var json = JSON.parse(data);
            if (this.options.mockConfig) {
                if (json.enable) {
                    cb(null, JSON.stringify(json[json.value]));
                }
            } else {
                return cb(null, data);
            }
        });
    } else {
        cb(null);
        this.options.logger.info("Can't find json data with the path '" + pathStr + "'");
    }
};

Mock.prototype._getTemplateData = function(type, url, req, res, cb) {
    var pathStr = path.join(process.cwd(), this.options.mockConfig.template.path + url + '.template');
    this.options.logger.info('Template data path is ' + pathStr.cyan);
    if (fs.existsSync(pathStr)) {
        fs.readFile(pathStr, 'utf-8', function(err, data) {
            var mockData = MockJs.mock(new Function('return ' + data)());
            cb(null, JSON.stringify(mockData));
        });
    } else {
        cb(null);
        this.options.logger.info("Can't find template data with the path '" + pathStr + "'");
    }
};

Mock.prototype._getCookieData = function(type, url, req, res, cb) {
    var configs = this.options.mockConfig.cookie,
        port = this.options.port || configs.port,
        options = {
            method: req.method || 'post',
            form: req.body || '',
            url: configs.host + url + (this.options.as || ''),
            port: port,
            headers: {
                'Cookie': configs.cookie,
            },
            rejectUnauthorized: !!configs.rejectUnauthorized,
            secureProtocol: configs.secureProtocol || ''
        };
    this.options.logger.info('Dispatch to ' + options.url.cyan);
    request(options, function(error, res, body) {
        cb(error, body);
    });
};

Mock.prototype._getCustomData = function(type, url, req, res, cb) {
    try {
        var mockSource = require(type),
            action = url + (this.options.as || '');
        mockSource.getData(action, req, res, cb);
    } catch (e) {
        this.options.logger.info("Can't find mock source " + type);
    }
};

var mock = new Mock();

module.exports = mock;