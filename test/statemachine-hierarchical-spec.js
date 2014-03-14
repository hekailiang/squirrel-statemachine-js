/*global require, module, it, describe*/
/*jslint nomen: true, ass: true, vars: true, plusplus:true*/
var should = require('chai').should(),
    expect = require('chai').expect,
    squirrel = require('../index'),
    StateMachine = squirrel.StateMachine,
    Events = squirrel.Events,
    keywords = squirrel.Keywords;

describe('#Hierarchical StateMachine function', function() {
  'use strict';

  var HierarchicalStateMachine = StateMachine.extend({
    statemachine : {
      states : {
        A : {
          onEntry : "entryA",
          onExit : "exitA",
          initial : true,
          children : {
            A1 : {
              onEntry : "entryA1",
              onExit : "exitA1",
              initial : true,
              children : {
                A1a : {onEntry : "entryA1a", onExit : "exitA1a", initial : true},
                A1b : {onEntry : "entryA1b", onExit : "exitA1b"}
              }
            },

            A2 : { onEntry : "entryA2", onExit : "exitA2" }
          }
        },

        B : {
          onEntry : "entryB",
          onExit : "exitB",
          children : {
            B1 : {
              onEntry : "entryB1",
              onExit : "exitB1",
              children : {
                B1a : { onEntry : "entryB1a", onExit : "exitB1a" },
                B1b : { onEntry : "entryB1b", onExit : "exitB1b" }
              }
            },

            B2 : { onEntry : "entryB2", onExit : "exitB2" }
          }
        }
      },

      transitions : [
        {from: "B", to : "B1a", on : "B2B1a", perform : "fromB2B1aOnB2B1a"},
        {from: "B1a", to : "B", on : "B1a2B", perform : "fromB1a2BOnB1a2B"},
        {from: "B1a", to : "B", on : "B1a2B_LOCAL", perform : "fromB1a2BOnB1a2B", transitionType : squirrel.TransitionType.LOCAL},
        {from: "A1a", to : "A", on : "A1a2A", perform : "fromA1a2AOnA1a2A"}
      ]
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

  it("The target state is a direct or indirect sub-state of the source state --> perform the transition actions, then traverse the " +
    "hierarchy from the source state down to the target state, entering each state along the way. No state is exited.", function() {
      var stateMachineInstance = new HierarchicalStateMachine("B");
      stateMachineInstance.start();
      stateMachineInstance.getCurrentState().should.equal("B");
      stateMachineInstance.callSequence = "";
      stateMachineInstance.fire("B2B1a");
      stateMachineInstance.callSequence.should.equal(".fromB2B1aOnB2B1a.entryB1.entryB1a");
  });

  it("The source state is a sub-state of the target state and perform external transition --> traverse the hierarchy from the source up to the target, "+
    "exiting each state along the way. Then perform transition actions. Finally enter the target state", function() {
    var stateMachineInstance = new HierarchicalStateMachine("B1a");
    stateMachineInstance.start();
    stateMachineInstance.getCurrentState().should.equal("B1a");
    stateMachineInstance.callSequence = "";
    stateMachineInstance.fire("B1a2B");
    stateMachineInstance.callSequence.should.equal(".exitB1a.exitB1.exitB.fromB1a2BOnB1a2B.entryB");
   });

  it("The source state is a sub-state of the target state and perform local transition --> traverse the hierarchy from the source up to the target, "+
    "exiting each state along the way but not include target state. Then perform transition actions.", function() {
    var stateMachineInstance = new HierarchicalStateMachine("B1a");
    stateMachineInstance.start();
    stateMachineInstance.getCurrentState().should.equal("B1a");
    stateMachineInstance.callSequence = "";
    stateMachineInstance.fire("B1a2B_LOCAL");
    stateMachineInstance.callSequence.should.equal(".exitB1a.exitB1.fromB1a2BOnB1a2B");
   });

});