/*global require, module, it, describe*/
/*jslint nomen: true, ass: true, vars: true, plusplus:true*/
var should = require('chai').should(),
    expect = require('chai').expect,
    squirrel = require('../index'),
    StateMachine = squirrel.StateMachine,
    Events = squirrel.Events,
    TransitionType = squirrel.TransitionType,
    HistoryType = squirrel.HistoryType;

describe('#StateMachine extension function', function() {
  'use strict';

  // initial state override[a][b][c]
  // state entry/exit action merge
  // state entry/exit action weight adjust
  // transition action merge
  // transition priority override
  // transition action weight adjust
  // transition extension method
});