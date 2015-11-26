'use strict';

require('colors');

var MockJs = require('mockjs'),
    fs = require('fs'),
    path = require('path'),
    request = require('request'),
    director = require('director'),
    co = require('co'),
    thunkify = require('thunkify'),
    router = new director.http.Router();
    
function Mock(options) {
    this.options = options || {};
    this.initRouter();

    this.thunkGetJsonData = thunkify(this.getJsonData);
    this.thunkGetTemplateData = thunkify(this.getTemplateData);
    this.thunkGetCookieData = thunkify(this.getCookieData);
    this.thunkGetCustomData = thunkify(this.getCustomData);
}

//init router
Mock.prototype.initRouter = function() {
    var as = this.options.as || '',
        mockConfig = this.options.mockConfig;
    //router action
    if (typeof as === 'string') {
        var suffix = as.split(',');
        for (var i = 0; i < suffix.length; i++) {
            var reg = '/(.*)' + suffix[i],
                me = this;
            function callback(url){
                if (mockConfig) {
                    me.mockTo.call(me, url, this.req, this.res);
                }
            }
            router.post(new RegExp(reg), callback);
            router.get(new RegExp(reg), callback);
        }
    }
};

Mock.prototype.dispatch = function(req, res) {
    return router.dispatch(req, res);
};

Mock.prototype.mockTo = function(url, req, res) {
    var me = this;
    co(function*() {
        for (var i = 0; i < me.options.mockConfig.dataSource.length; i++) {
            var method = me.getMockData(me.options.mockConfig.dataSource[i]);
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

Mock.prototype.getMockData = function(type) {
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


Mock.prototype.getJsonData = function(type, url, req, res, cb) {
    var pathStr = path.join(process.cwd(), this.options.mockConfig.json.path + url + (this.options.mockConfig.json.suffix || '.json'));
    this.options.logger.info('Json data path is ' + pathStr.cyan);
    if (fs.existsSync(pathStr)) {
        fs.readFile(pathStr, 'utf-8', function(err, data){
            if (err) throw cb(err);
            var json = JSON.parse(data);
            if (this.options.mockConfig){
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

Mock.prototype.getTemplateData = function(type, url, req, res, cb) {
    var pathStr = path.join(process.cwd(), this.options.mockConfig.template.path + url + '.template');
    this.options.logger.info('Template data path is ' + pathStr.cyan);
    if (fs.existsSync(pathStr)) {
        fs.readFile(pathStr, 'utf-8', function(err, data){
            var mockData = MockJs.mock(new Function('return ' + data)());
            cb(null, JSON.stringify(mockData));
        });
    } else {
        cb(null);
        this.options.logger.info("Can't find template data with the path '" + pathStr + "'");
    }
};

Mock.prototype.getCookieData = function(type, url, req, res, cb) {
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
    request(options, function(error, res, body){
        cb(error, body);
    });
};

Mock.prototype.getCustomData = function(type, url, req, res, cb) {
    try{
        var mockSource = require(type),
            action  = url + (this.options.as || '');
        mockSource.getData(action, req, res, cb);
    } catch(e) {
        this.options.logger.info("Can't find mock source " + type);
    }
};

module.exports = Mock;