// RockUp
// Config -- Load, read, and manipulate deploy configuration files

var _ = require('underscore');
var inspect = require('util').inspect;
var fs = require("fs");
var path = require("path");
var ejs = require("ejs");

var Host = require("./Host");
var Service = require("./Service");
var Hook = require("./Hook");

module.exports = Config;

/**
 * Create an instance of a configuration object for a given environment.
 * Pass a string containing the filepath to a rockup file to load
 * configuration from that file. Pass an Object to use as the configuration
 * otherwise. If the passed configuration does not specify an environment
 * name, one can be provided as the second argument.
 *
 * @param {Str|Obj} pathOrCfg   Path to RockUp file or JS Object containing
 *                              full configuration.
 * @param {String} envName      (opt.) The name of the environment, if not
 *                              defined within the rockup file.
 **/
function Config (pathOrCfg, envName) {
  if ( _.isObject(pathOrCfg) ) {
    // Load from an object and set relative dir to cwd:
    this.rootDir = process.cwd();
    this.src = Config._compile( pathOrCfg, this.rootDir );
  }
  else if ( _.isString(pathOrCfg) ) {
    // Load from a file path and set relative dir to match:
    this.rootDir = path.dirname(pathOrCfg);
    this.src = Config._compile( Config._loadJSON( pathOrCfg ), this.rootDir );
  }

  this.app = this.src.app;
  this.environment = this.src.environment || envName;
  this.hosts = this._extractHosts();
  this.hooks = this._extractHooks();
  delete this.src;    // used for extraction, then unneeded
}

/**
 * Return an array of target environment names currently defined in
 * rockup files local to the working dir.
 *
 * @param {String} rockupDir    The directory in which to search for configs
 * @returns {Array} List of environment names
 **/
Config.list = function (rockupDir) {
  if ( ! fs.existsSync(rockupDir) )
    throw new Error("RockUp directory "+rockupDir+" not found.");
  var allFiles = fs.readdirSync(rockupDir);
  var envNames = allFiles.reduce(function(memo, fileName) {
    if ( fileName.match(/\.rockup\.json$/) ) {
      memo.push( fileName.replace(/\.rockup\.json$/, '') );
    }
    return memo;
  }, []);
  return envNames;
};

/**
 * Create local base configuration files for the given application and
 * environment. Places a RockUp configuration 
 *
 * @param {String} environment    Name of the target environment
 * @param {String[]} files        Array of file types to generate. Default
 *                                options include 'rockup', 'meteor'
 * @param {String} appName        Name of the application
 * @param {String} appPath        Path to app dir relative to /deploy
 **/
Config.initialize = function (environment, files, appName, appPath) {
  files = _.isUndefined(files) ? ['rockup', 'meteor'] : files;
  var templateDir = path.resolve(__dirname, '..', 'templates');
  var targetDir = path.resolve( process.cwd(), 'deploy' );
  var extMap = {
    rockup:   'rockup.json',
    meteor:   'settings.json',
    nginx:    'nginx.conf',
    upstart:  'upstart.conf'
  };

  // Create deploy directory:
  if ( fs.existsSync(targetDir) ) {
    console.log("Config directory already exists:".yellow, "Skipping.".red);
  } else {
    console.log("Creating config directory:".yellow, targetDir.cyan);
    fs.mkdirSync( targetDir );
  }

  // Copy desired template files into target directory:
  _.each(extMap, function( ext, type ) {
    if ( _.indexOf(files, type) > -1 ) {
      var basename = environment+"."+ext;                     // e.g., "staging.rockup.json"
      var source = path.resolve(templateDir, ext);
      var target = path.resolve(targetDir, basename);
      if ( fs.existsSync(target) ) {
        console.log("Config for", type, "already exists.".yellow, "Skipping.".red);
      } else {
        console.log("Creating config for", type, "from template".yellow, basename.cyan);
        var vars;
        if (type == 'rockup')
          vars = {
            envName: environment,
            appName: appName || "myapp",
            appPath: appPath || '../app',
            settingsFile: environment+".settings.json"
          };
        copyFile(source, target, vars);
      }
    } else {
      // TODO: console.log("Skipping", type, "configuration. Not requested.");
    }
  });

  console.log("Rockup project local config initialized".bold.green);

  // Optionally does EJS templating
  function copyFile(src, dest, vars) {
    var content = fs.readFileSync(src, 'utf8');
    if (vars) {
      content = ejs.compile(content, {})(vars);
    }
    fs.writeFileSync(dest, content);
  }

};

/**
 * Load RockUp configuration file from the expected path relative to
 * this process' working directory (for use by applications, CLI).
 *
 * @param {String} environment  Name of target environment
 * @returns {Config}            RockUp Config object
 * @throws Errors associated with loading Config (non-exist, syntax)
 **/
Config._loadLocalConfigFile = function (environment) {
  return new Config( Config._expectedLocalConfigFilePath(environment) );
};

/**
 * Programmatically return the best-practice file path for the local
 * RockUp file for the given environment. File is expected to be stored
 * in ./deploy/{environment}.rockup.json.
 *
 * @param {String} environment  Name of target environment
 * @returns {String}            Full resolved path to expected file
 **/
Config._expectedLocalConfigFilePath = function (environment) {
  return path.resolve( process.cwd(), 'deploy', environment+'.rockup.json' );
};

/**
 * Load RockUp configuration from the given JSON filePath.
 *
 * @param {String} filePath   Path to the rockup.json file
 * @returns {Object}          JSON contents of file
 * @throws                    Error for nonexist filePath
 * @throws                    Error for JSON load/syntax failure
 **/
Config._loadJSON = function ( filePath ) {
  if ( fs.existsSync(filePath) ) {
    // Load the JSON configuration:
    try {
      return require(filePath);
    } catch (jsonErr) {
      throw new Error("Error loading JSON config "+filePath+": "+jsonErr);
    }
  } else {
    throw new Error("RockUp configuration file "+filePath+" not found. Run `rock init`.");
  }
};

/**
 * Builds the true configuration by merging defaults into the host- and
 * service-specific definitions. Also adjusts filepaths to respect the
 * configuration rootDir.
 *
 * Boils down the given raw rockup configuration, merging defaults from separate
 * section into host- and service-specific definitions.
 *
 * @param {Object} rawConfig    The raw JSON source
 * @param {String} rootDir      The root directory this config loaded from
 * @returns {Object}            Compiled JSON source
 **/
Config._compile = function ( rawConfig, rootDir ) {
  var config = _.extend({}, rawConfig);
  rootDir = rootDir || process.cwd();
  config.app.path = path.resolve( rootDir, config.app.path );
  _.each(config.hosts, function(host, idx) {
    host = _.defaults(host, rawConfig.defaults.hosts);
    _.each(host.services, function(service, idx) {
      service = _.defaults(service, rawConfig.defaults.services);
      if (service.settingsPath)
        service.settingsPath = path.resolve( rootDir, service.settingsPath );
      service.env = _.defaults({}, service.env, rawConfig.defaults.services.env);
    });
  });
  _.each(config.hooks, function(scriptPath, hookEvent) {
    if (hookEvent !== '--comment' && scriptPath) 
      config.hooks[hookEvent] = path.resolve( rootDir, scriptPath );
  });
  delete config.defaults;
  return config;
};

/**
 * Extract host information from the source configuration.
 **/
Config.prototype._extractHosts = function () {
  return {
    count: this.src.hosts.length,
    list: _.map( this.src.hosts, function(info) { 
      info.environment = this.environment;
      info.app = this.app;
      return new Host(info); 
    }, this ),
    names: _.pluck( this.src.hosts, 'name' ),
    get: function(name) { return _.findWhere(this.list, {name: name}); },
    first: function() { return this.list[0]; },
    each: function(predicate) { _.each(this.list, function(h, i) { predicate(h, i); }); },
    map: function(predicate) { return _.map(this.list, function(h, i) { return predicate(h, i); }); }
  };
};

/**
 * Extract script hooks from the source configuration.
 **/
Config.prototype._extractHooks = function () {
  var hooks = {};
  _(this.src.hooks).each( function(scriptPath, eventName) {
    if (eventName !== '--comment' && scriptPath)
      hooks[eventName] = new Hook(eventName, scriptPath);
  });
  return hooks;
};

/**
 * Return a JSON representation of this configuation. This is roughly the reverse of loading
 * from source, but does not repopulate the defaults object.
 *
 * @returns {Object} A JavaScript object representing this configuration
 **/
Config.prototype.toJSON = function () {
  var cObj = {
    environment: this.environment,
    app: this.app,
    hosts: []
  };
  this.hosts.each( function(host) {
    var hObj = {
      name: host.name,
      username: host.username,
      services: []
    };
    host.services.each( function(service) {
      var sObj = {
        name: service.name,
        settingsPath: service.settingsPath,
        env: service.env
      };
      hObj.services.push(sObj);
    });
    cObj.hosts.push(hObj);
  });
  return cObj;
};

/**
 * Return a list of services for a specified host with a fully populated configuration
 **/
Config.prototype.services = function ( hostName ) {
  var host = this.hosts.get(hostName);
  return (host && host.services) ? host.services : [];
};

/**
 * Return the specific configuration for the named service on the named host
 **/
Config.prototype.service = function ( hostName, serviceName ) {
  return this.services(hostName).get(serviceName);
};
