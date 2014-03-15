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

  var BaseExtensionStateMachine = StateMachine.extend({
      statemachine : {
        initial : "A",
        states : {
          A: {onEntry: "entryA", onExit: "exitA"},
          B: {onEntry: "entryB", onExit: "exitB"}
        },

        transitions : [
          {from: "A", to: "B", on: "A2B", perform: "fromA2B"},
          {from: "B", to: "A", on: "B2A", perform: "fromB2A"}
        ]
      },

      // state machine initialize function
      initialize : function() {
        this.callSequence = "";
      },

      methodMissing : function(methodName) {
        if(this.callSequence.length>0) {
          this.callSequence += ".";
        }
        this.callSequence += methodName;
      }

    });

  it("EntryAny/ExitAny should be called whenever any state entered/exited", function() {
    var ExtensionStateMachine = BaseExtensionStateMachine.extend({
      entryAny : function() {
        this.callSequence += ".entryAny";
      },

      exitAny : function() {
        this.callSequence += ".exitAny";
      }
    }), stateMachine = new ExtensionStateMachine();
    stateMachine.start();
    stateMachine.getCurrentState().should.equal("A");
    stateMachine.terminate();
    stateMachine.callSequence.should.equal("entryA.entryAny.exitA.exitAny");
  });

  it("transitFrom[source]To[target]On[event] extension method should be called when naming convention satisfied",  function() {
    var ExtensionStateMachine = BaseExtensionStateMachine.extend({
      transitFromAToBOnA2B : function() {
        this.callSequence += ".transitFromAToBOnA2B";
      }
    }), stateMachine = new ExtensionStateMachine();
    stateMachine.start();
    stateMachine.getCurrentState().should.equal("A");
    stateMachine.callSequence = "";
    stateMachine.fire("A2B");
    stateMachine.callSequence.should.equal("exitA.fromA2B.transitFromAToBOnA2B.entryB");
  });

  it("transitFrom[source]ToAnyOn[event] extension method should be called when naming convention satisfied",  function() {
    var ExtensionStateMachine = BaseExtensionStateMachine.extend({
      statemachine : {
        states : {
          B : {
            children : {
              B1: {onEntry: "entryB1", onExit: "exitB1"}
            }
          }
        },
        transitions : [
          {from: "A", to: "B1", on: "A2B", perform: "fromA2B1", when: function(context) {return context>10;} }
        ]
      },

      transitFromAToAnyOnA2B : function() {
        this.callSequence += ".transitFromAToAnyOnA2B";
      }
    }), stateMachine = new ExtensionStateMachine();

    stateMachine.start();
    stateMachine.getCurrentState().should.equal("A");
    stateMachine.callSequence = "";
    stateMachine.fire("A2B", 15);
    stateMachine.callSequence.should.equal("exitA.fromA2B1.transitFromAToAnyOnA2B.entryB.entryB1");
  });

  // initial state override[a][b][c]
  // state entry/exit action merge
  // state entry/exit action weight adjust
  // transition action merge
  it("Transition in extended state machine should merge its actions with the matched transition in base state machine.", function() {
    var ExtensionStateMachine = BaseExtensionStateMachine.extend({
      statemachine : {
        transitions : [
          {from: "A", to: "B", on: "A2B", perform: "fromA2BEx"}
        ]
      }
    }), stateMachine = new ExtensionStateMachine();

    stateMachine.start();
    stateMachine.getCurrentState().should.equal("A");
    stateMachine.callSequence = "";
    stateMachine.fire("A2B");
    stateMachine.callSequence.should.equal("exitA.fromA2BEx.fromA2B.entryB");
  });
  // transition priority override
  // transition action weight adjust
  // transition extension method
});