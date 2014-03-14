/*global require, module, it, describe*/
/*jslint nomen: true, ass: true, vars: true, plusplus:true*/
var should = require('chai').should(),
    expect = require('chai').expect,
    squirrel = require('../index'),
    StateMachine = squirrel.StateMachine,
    Events = squirrel.Events;

describe('#Hierarchical StateMachine function', function() {
  'use strict';
  var HierarchicalStateMachine = StateMachine.extend({
    definition : {
      states : {
        A : {
          onEntry : "entryA",
          onExit : "exitA",
          initial : true,
          childStates : {
            A1 : {
              onEntry : "entryA1",
              onExit : "exitA1",
              initial : true,
              childStates : {
                A1a : {onEntry : "entryA1a", onExit : "exitA1a", initial : true},
                A1b : {onEntry : "entryA1b", onExit : "exitA1b"}
              }
            },

            A2 : { onEntry : "entryA2", onExit : "exitA2" }
          }
        },

        B : { onEntry : "entryB", onExit : "exitB" }
      },

      transitions : []
    },

    // state machine initialize function
    initialize : function() {
      this.callSequence = "";
    },

    unfoundMethod : function(methodName) {
      this.callSequence += "."+methodName;
    }
  });

  it("Hierarchical child state should be entered after all its parent state being entered when state machine start", function() {
    var stateMachineInstance = new HierarchicalStateMachine("A1a");
    stateMachineInstance.start();
    stateMachineInstance.callSequence.should.equal(".entryA.entryA1.entryA1a");
  });

  it("Hierarchical child state should be exited before all its parent state being exited sequencially when state machine terminate", function() {
    var stateMachineInstance = new HierarchicalStateMachine("A1a");
    stateMachineInstance.start();
    stateMachineInstance.callSequence = "";
    stateMachineInstance.terminate();
    stateMachineInstance.callSequence.should.equal(".exitA1a.exitA1.exitA");
  });
});