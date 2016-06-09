// RockUp
// Commands-Status -- Load stopped/running state for services

var Spinner = CLUI.Spinner;
var reduceAsync = require("../lib/Async").reduce;
var Config = require('../lib/Config');

module.exports = StatusCommand;

function StatusCommand (program) {

  program
    .command("status <environment>")
    .description("Display status for running/stopped services")
    .action( function(env, cliOptions) {
      var config = Config._loadLocalConfigFile(env);

      var numHosts = config.hosts.count;
      var spinner = new Spinner('Querying '+numHosts+' host(s) for service status...');
      spinner.start();

      var ops = config.hosts.map( function(host) {
        return function (memo, cb) {
          host.status( function(err, status, map) {
            --numHosts;
            spinner.message('Querying '+numHosts+' host(s) for service status...');
            if (err) { 
              cb(err); 
            }
            else {
              memo[host.name] = [status, map];
              cb();
            }
          }); // host.status
        }; // return
      }); // map

      // Receives map of hostname: [status string, serviceMap{}]
      function allHostsComplete ( statusMap ) {
        spinner.stop();
        console.log("");
        _.each( statusMap, function(statusDetails, hostName) {
          var status = statusDetails[0];
          var serviceMap = statusDetails[1];
          console.log(hostName.bold, "\t", _colorizeStatus(status), "\t", inspect(serviceMap).replace("\n", " ") );
        });
        console.log("");
        process.exit(0);
      }

      ops.unshift({}); // memo
      ops.push(allHostsComplete);

      reduceAsync.apply(this, ops);

      function _colorizeStatus(s) {
        if (s == 'running') return s.green.bold;
        else if (s == 'stopped') return s.red.bold;
        else return s.yellow.bold;
      }

    });

  return program;
}
