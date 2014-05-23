var request = require('request');
var http = require('http');
var https = require('https');
var zlib = require('zlib');

var gracenode = require('../gracenode');
var log = gracenode.log.create('request');

/*
options: {
	headers: <object>,
	encoding: <string>,
	gzip: <boolean>
}
*/

module.exports.GET = function (url, args, options, cb) {
	send(url, 'get', args, options, cb);
};

module.exports.HEAD = function (url, args, options, cb) {
	send(url, 'head', args, options, cb);
};

module.exports.POST = function (url, args, options, cb) {
	send(url, 'post', args, options, cb);
};

module.exports.PUT = function (url, args, options, cb) {
	send(url, 'put', args, options, cb);
};

module.exports.DELETE = function (url, args, options, cb) {
	send(url, 'del', args, options, cb);
};

function send(url, method, args, options, cb) {
	if (!options) {
		options = {};
	}
	var params = {
		encoding: options.encoding || null,
		url: url,
		headers: options.headers || {}
	};
	if (method === 'get') {
		params.form = args;
	} else if (method === 'head') {
		params.body = null;
	} else {
		params.body = args;
		params.json = true;
	}

	var sender = request[method] || null;
	
	if (!sender) {
		return cb(new Error('invalid request method given: ' + method.toUpperCase()));
	}

	var gzip = options.gzip || false;

	sender(params, function (error, res, body) {
		if (error) {
			return cb(error, body, res.statusCode);
		}
		if (!gzip) {
			return cb(null, body, res.statusCode);
		}
		zlib.gunzip(body, function (err, unzipped) {
			if (err) {
				return cb(err, body, res.statusCode);
			}
			unzipped = unzipped.toString();
			try {
				body = JSON.parse(unzipped);
			} catch (e) {
				body = unzipped;
			}
			cb(res.statusCode > 399 ? new Error(res.statusCode) : null, body, res.statusCode);
		});
	});
}

/**
 * @param {object} { protocol: http/https, hots: string, path: string. port: number, method: string, data: object }
 * @options {object} { agent: <int>, headers: object, timeout: miliseconds }
 * */
module.exports.send = function (params, options, cb) {
	if (!params) {
		return cb(new Error('missing required arguement 1'));
	}

	var protocol = params.protocol || 'http';
	var host = params.host || null;
	var path = params.path || null;
	if (!host || !path) {
		return cb(new Error('missing host or path: \n' + JSON.stringify(params, null, 4)));
	}
	
	var port = params.port || null;
	var method = params.method || 'GET';
	var data = params.data || null;
	// construct GET/POST data if given
	if (data) {
		data = JSON.stringify(data);
		if (!options) {
			options = {};
		}
		if (!options.headers) {
			options.headers = {};
		}
		options.headers['Content-Length'] = Buffer.byteLength(data);

		// check method
		if (method === 'GET') {
			path += '?' + data;
			data = null;
		}
	}
	// check options
	var headers = null;
	if (options) {
		headers = options.headers || null;
	}
	// create and send a http request
	var args = {
		host: host,
		path: path,
		method: method,
		headers: headers,
		agent: options.agent || false
	};
	if (port) {
		args.port = port;
	}
	// respond callback handler
	var timer = null;
	var responseData = '';
	var serverResponse = null;
	var callback = function (res) {

		serverResponse = res;

		log.verbose('response status code: ', res.statusCode);
		log.verbose('response headers: ', res.headers);

		res.setEncoding('utf8');

		// response handlers
		res.on('data', function (dataChunck) {
			
			log.verbose('data reviced');
			
			responseData += dataChunck;
		});
		res.on('end', function () {

			clearTimeout(timer);

			log.verbose('request complete  > disconnected from ' + protocol + '://' + host + path);

			cb(null, { status: res.statusCode, headers: res.headers, data: responseData });
		});
		res.on('error', function (error) {
			
			clearTimeout(timer);

			cb(error, { status: res.statusCode, headers: res.headers, data: responseData });
		});
	};

	log.verbose('connecting to ' + protocol + '://' + host + path);
	log.verbose('sending request: ', args);
	log.verbose('sending ' + method + ' data: ', data);

	// check request protocol
	var sender = http;
	if (protocol === 'https') {
		sender = https;
	}
	// send request
	try {

		var req = sender.request(args, callback);
		
		req.on('error', function (error) {
			
			clearTimeout(timer);

			log.error('request error:');

			cb(error, { status: null, headers: null, data: responseData });
		});
		
		if (data) {
			req.write(data);
		}
		req.end();
		
		// set up time out
		var timeout = 3000; // 3 econds by default
		if (options && options.timeout) {
			timeout = options.timeout;
		}
		timer = setTimeout(function () {
			
			log.warning('request timed out: ' + protocol + '://' + host + path);

			if (serverResponse) {
				serverResponse.emit('end', new Error('connection timeout'));
			} else {
				req.abort();
			}
		}, timeout);

		log.verbose('sent headers: ', req._headers);
	
	} catch (exception) {
		
		log.error(exception);

		cb(exception, { status: null, headers: null, data: responseData });
	}
};
