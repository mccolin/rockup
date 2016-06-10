#!/usr/bin/env node

program = require('commander');
CLUI = require('clui');
colors = require('colors');
_ = require('underscore');
inspect = require('util').inspect;

// Define CLI program:
program
  .version("0.0.1")
  .description("Faceted deployment and configuration management for Meteor applications");

// Define and attach sub-commands:
require('../commands/rock-init') (program);
require('../commands/rock-prepare') (program);
require('../commands/rock-deploy') (program);
require('../commands/rock-history') (program);
require('../commands/rock-rollback') (program);
require('../commands/rock-startstop') (program);
require('../commands/rock-status') (program);
require('../commands/rock-reconfig') (program);
require('../commands/rock-logs') (program);
require('../commands/rock-list') (program);
require('../commands/rock-lint') (program);

// Explicit subcommand help
program
  .command('help [command]')
  .description("Display usage and help for commands")
  .action( function(command) {
    var commandDef = command ? _.findWhere(program.commands, {_name: command}) : null;
    if (command && commandDef)
      require('child_process').spawn("rock", [command, "-h"], {stdio: [process.stdin, process.stdout, process.stderr] });
    else
      program.help();
  });

console.log();
program.parse(process.argv);
