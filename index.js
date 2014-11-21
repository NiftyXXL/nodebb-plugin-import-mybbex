
var async = require('async');
var mysql = require('mysql');
var _ = require('underscore');
var noop = function(){};
var logPrefix = '[nodebb-plugin-import-mybbex]';

(function(Exporter) {

    Exporter.setup = function(config, callback) {
        Exporter.log('setup');

        // mysql db only config
        // extract them from the configs passed by the nodebb-plugin-import adapter
        var _config = {
            host: config.dbhost || config.host || 'localhost',
            user: config.dbuser || config.user || 'user',
            password: config.dbpass || config.pass || config.password || 'password',
            port: config.dbport || config.port || 3306,
            database: config.dbname || config.name || config.database || 'mybb'
        };

        Exporter.config(_config);
        Exporter.config('prefix', config.prefix || config.tablePrefix || '');

        Exporter.connection = mysql.createConnection(_config);
        Exporter.connection.connect();

        callback(null, Exporter.config());
    };

    var getGroups = function(config, callback) {
        if (_.isFunction(config)) {
            callback = config;
            config = {};
        }
        callback = !_.isFunction(callback) ? noop : callback;
        if (!Exporter.connection) {
            Exporter.setup(config);
        }
        var prefix = Exporter.config('prefix');
        var query = 'SELECT '
            + prefix + 'usergroups.gid as _gid, '
            + prefix + 'usergroups.title as _title, ' // not sure, just making an assumption
            + prefix + 'usergroups.canusepms as _pmpermissions, ' // not sure, just making an assumption
            + prefix + 'usergroups.issupermod as _adminpermissions ' // not sure, just making an assumption
            + ' from ' + prefix + 'usergroups ';
        Exporter.connection.query(query,
            function(err, rows) {
                if (err) {
                    Exporter.error(err);
                    return callback(err);
                }
                var map = {};

                //figure out the admin group
                var max = 0, admingid;
                rows.forEach(function(row) {
                    var adminpermission = parseInt(row._adminpermissions, 10);
                    if (adminpermission) {
                        if (adminpermission > max) {
                            max = adminpermission;
                            admingid = row._gid;
                        }
                    }
                });

                rows.forEach(function(row) {
                    if (! parseInt(row._pmpermissions, 10)) {
                        row._banned = 1;
                        row._level = 'member';
                    } else if (parseInt(row._adminpermissions, 10)) {
                        row._level = row._gid === admingid ? 'administrator' : 'moderator';
                        row._banned = 0;
                    } else {
                        row._level = 'member';
                        row._banned = 0;
                    }
                    map[row._gid] = row;
                });
                // keep a copy of the users in memory here
                Exporter._groups = map;
                callback(null, map);
            });
    };

    Exporter.getUsers = function(callback) {
        return Exporter.getPaginatedUsers(0, -1, callback);
    };
    Exporter.getPaginatedUsers = function(start, limit, callback) {
        callback = !_.isFunction(callback) ? noop : callback;

        var err;
        var prefix = Exporter.config('prefix') || '';
        var startms = +new Date();

        var query = 'SELECT '
            + prefix + 'users.uid as _uid, '
            + prefix + 'users.email as _email, '
            + prefix + 'users.username as _username, '
            + prefix + 'users.signature as _signature, '
            + prefix + 'users.regdate as _joindate, '
            + prefix + 'users.avatar as _pictureFilename, '
            + prefix + 'users.website as _website, '
            + prefix + 'users.reputation as _reputation, '
            + prefix + 'users.birthday as _birthday '
            + 'FROM ' + prefix + 'users '
            + (start >= 0 && limit >= 0 ? 'LIMIT ' + start + ',' + limit : '');

        if (!Exporter.connection) {
            err = {error: 'MySQL connection is not setup. Run setup(config) first'};
            Exporter.error(err.error);
            return callback(err);
        }

        getGroups(function(err, groups) {
            Exporter.connection.query(query,
                function(err, rows) {
                    if (err) {
                        Exporter.error(err);
                        return callback(err);
                    }

                    //normalize here
                    var map = {};
                    rows.forEach(function(row) {
                        // nbb forces signatures to be less than 150 chars
                        // keeping it HTML see https://github.com/akhoury/nodebb-plugin-import#markdown-note
                        row._signature = Exporter.truncateStr(row._signature || '', 150);

                        // from unix timestamp (s) to JS timestamp (ms)
                        row._joindate = ((row._joindate || 0) * 1000) || startms;
                        
                        // lower case the email for consistency
                        row._email = (row._email || '').toLowerCase();
                        row._website = Exporter.validateUrl(row._website);

                        row._level = (groups[row._gid] || {})._level || '';
                        row._banned = (groups[row._gid] || {})._banned || 0;

                        map[row._uid] = row;
                    });

                    callback(null, map);
                });
        });
    };

    Exporter.getCategories = function(callback) {
        return Exporter.getPaginatedCategories(0, -1, callback);
    };
    Exporter.getPaginatedCategories = function(start, limit, callback) {
        callback = !_.isFunction(callback) ? noop : callback;

        var err;
        var prefix = Exporter.config('prefix');
        var startms = +new Date();

        var query = 'SELECT '
            + prefix + 'forums.fid as _cid, '
            + prefix + 'forums.name as _name, '
            + prefix + 'forums.description as _description, '
            + prefix + 'forums.disporder as _order, '
            + 'substring_index(substring_index(concat(\',\','+ prefix +'forums.parentlist),\',\',-2),\',\',1) as _parentCid '
            + 'FROM ' + prefix + 'forums ' // filter added later
            + 'ORDER BY ' + prefix + 'forums.parentlist '
            + (start >= 0 && limit >= 0 ? 'LIMIT ' + start + ',' + limit : '');

        if (!Exporter.connection) {
            err = {error: 'MySQL connection is not setup. Run setup(config) first'};
            Exporter.error(err.error);
            return callback(err);
        }

        Exporter.connection.query(query,
            function(err, rows) {
                if (err) {
                    Exporter.error(err);
                    return callback(err);
                }

                //normalize here
                var map = {};
                rows.forEach(function(row) {
                    row._name = row._name || 'Untitled Category '
                    row._description = row._description || 'No decsciption available';
                    row._timestamp = ((row._timestamp || 0) * 1000) || startms;
                    map[row._cid] = row;
                });

                callback(null, map);
            });
    };

    Exporter.getTopics = function(callback) {
        return Exporter.getPaginatedTopics(0, -1, callback);
    };
    Exporter.getPaginatedTopics = function(start, limit, callback) {
        callback = !_.isFunction(callback) ? noop : callback;

        var err;
        var prefix = Exporter.config('prefix');
        var startms = +new Date();
        var query = 'SELECT '
            + prefix + 'threads.tid as _tid, '
            + prefix + 'posts.uid as _uid, '
            + prefix + 'threads.fid as _cid, '
            + prefix + 'posts.subject as _title, '
            + prefix + 'posts.message as _content, '
            + prefix + 'posts.username as _guest, '
            + prefix + 'posts.ipaddress as _ip, '
            + prefix + 'posts.dateline as _timestamp, '
            + prefix + 'threads.views as _viewcount, '
            + prefix + 'threads.closed!="" as _open, '
            + prefix + 'threads.deletedposts as _deleted, '
            + prefix + 'threads.sticky as _pinned '
            + 'FROM ' + prefix + 'threads '
            + 'JOIN ' + prefix + 'posts ON ' + prefix + 'threads.firstpost=' + prefix + 'posts.pid '
            + (start >= 0 && limit >= 0 ? 'LIMIT ' + start + ',' + limit : '');


        if (!Exporter.connection) {
            err = {error: 'MySQL connection is not setup. Run setup(config) first'};
            Exporter.error(err.error);
            return callback(err);
        }

        Exporter.connection.query(query,
            function(err, rows) {
                if (err) {
                    Exporter.error(err);
                    return callback(err);
                }

                //normalize here
                var map = {};
                rows.forEach(function(row) {
                    row._title = row._title ? row._title[0].toUpperCase() + row._title.substr(1) : 'Untitled';
                    row._timestamp = ((row._timestamp || 0) * 1000) || startms;
                    row._locked = row._open ? 0 : 1;
                    
                    map[row._tid] = row;
                });

                callback(null, map);
            });
    };

    Exporter.getPosts = function(callback) {
        return Exporter.getPaginatedPosts(0, -1, callback);
    };
    Exporter.getPaginatedPosts = function(start, limit, callback) {
        callback = !_.isFunction(callback) ? noop : callback;

        var err;
        var prefix = Exporter.config('prefix');
        var startms = +new Date();
        var query = 'SELECT '
            + prefix + 'posts.pid as _pid, '
            + prefix + 'posts.tid as _tid, '
            + prefix + 'posts.uid as _uid, '
            + prefix + 'posts.username as _guest, '
            + prefix + 'posts.ipaddress as _ip, '
            + prefix + 'posts.message as _content, '
            + prefix + 'posts.dateline as _timestamp '
            + 'FROM ' + prefix + 'posts '
	    + 'JOIN ' + prefix + 'threads ON ' + prefix + 'posts.tid='+ prefix + 'threads.tid'
	    + ' WHERE ' + prefix + 'posts.pid!=' + prefix + 'threads.firstpost '
            + (start >= 0 && limit >= 0 ? 'LIMIT ' + start + ',' + limit : '');

        if (!Exporter.connection) {
            err = {error: 'MySQL connection is not setup. Run setup(config) first'};
            Exporter.error(err.error);
            return callback(err);
        }

        Exporter.connection.query(query,
            function(err, rows) {
                if (err) {
                    Exporter.error(err);
                    return callback(err);
                }

                //normalize here
                var map = {};
                rows.forEach(function(row) {
                    row._content = row._content || '';
                    row._timestamp = ((row._timestamp || 0) * 1000) || startms;
                    map[row._pid] = row;
                });

                callback(null, map);
            });
    };

    Exporter.teardown = function(callback) {
        Exporter.log('teardown');
        Exporter.connection.end();

        Exporter.log('Done');
        callback();
    };

    Exporter.testrun = function(config, callback) {
        async.series([
            function(next) {
                Exporter.setup(config, next);
            },
            function(next) {
                Exporter.getUsers(next);
            },
            function(next) {
                Exporter.getCategories(next);
            },
            function(next) {
                Exporter.getTopics(next);
            },
            function(next) {
                Exporter.getPosts(next);
            },
            function(next) {
                Exporter.teardown(next);
            }
        ], callback);
    };

    Exporter.paginatedTestrun = function(config, callback) {
        async.series([
            function(next) {
                Exporter.setup(config, next);
            },
            function(next) {
                Exporter.getPaginatedUsers(0, 1000, next);
            },
            function(next) {
                Exporter.getPaginatedCategories(0, 1000, next);
            },
            function(next) {
                Exporter.getPaginatedTopics(0, 1000, next);
            },
            function(next) {
                Exporter.getPaginatedPosts(1001, 2000, next);
            },
            function(next) {
                Exporter.teardown(next);
            }
        ], callback);
    };

    Exporter.warn = function() {
        var args = _.toArray(arguments);
        args.unshift(logPrefix);
        console.warn.apply(console, args);
    };

    Exporter.log = function() {
        var args = _.toArray(arguments);
        args.unshift(logPrefix);
        console.log.apply(console, args);
    };

    Exporter.error = function() {
        var args = _.toArray(arguments);
        args.unshift(logPrefix);
        console.error.apply(console, args);
    };

    Exporter.config = function(config, val) {
        if (config != null) {
            if (typeof config === 'object') {
                Exporter._config = config;
            } else if (typeof config === 'string') {
                if (val != null) {
                    Exporter._config = Exporter._config || {};
                    Exporter._config[config] = val;
                }
                return Exporter._config[config];
            }
        }
        return Exporter._config;
    };

    // from Angular https://github.com/angular/angular.js/blob/master/src/ng/directive/input.js#L11
    Exporter.validateUrl = function(url) {
        var pattern = /^(ftp|http|https):\/\/(\w+:{0,1}\w*@)?(\S+)(:[0-9]+)?(\/|\/([\w#!:.?+=&%@!\-\/]))?$/;
        return url && url.length < 2083 && url.match(pattern) ? url : '';
    };

    Exporter.truncateStr = function(str, len) {
        if (typeof str != 'string') return str;
        len = _.isNumber(len) && len > 3 ? len : 20;
        return str.length <= len ? str : str.substr(0, len - 3) + '...';
    };

    Exporter.whichIsFalsy = function(arr) {
        for (var i = 0; i < arr.length; i++) {
            if (!arr[i])
                return i;
        }
        return null;
    };

})(module.exports);
