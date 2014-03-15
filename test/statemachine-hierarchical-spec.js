/*global require, module, it, describe*/
/*jslint nomen: true, ass: true, vars: true, plusplus:true*/
var should = require('chai').should(),
    expect = require('chai').expect,
    squirrel = require('../index'),
    StateMachine = squirrel.StateMachine,
    Events = squirrel.Events,
    TransitionType = squirrel.TransitionType,
    HistoryType = squirrel.HistoryType;

describe('#Hierarchical StateMachine function', function() {
  'use strict';

  var HierarchicalStateMachine = StateMachine.extend({
    machine : {
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
        },

        C : {
          history : HistoryType.DEEP,
          children : {
            C1 : {
              history : HistoryType.DEEP,
              children : {
                C1a : {},
                C1b : {}
              }
            },
            C2 : {}
          }
        },

        D: {
          history : HistoryType.SHALLOW,
          children : {
            D1 : {
              history : HistoryType.SHALLOW,
              children : {
                D1a : {},
                D1b : {}
              }
            },
            D2 : {}
          }
        },
      },

      transitions : [
        {from: "B", to : "B1a", on: "B2B1a", perform: "fromB2B1aOnB2B1a"},
        {from: "B1a", to : "B", on: "B1a2B", perform: "fromB1a2BOnB1a2B"},
        {from: "B1a", to : "B", on: "B1a2B_LOCAL", perform: "fromB1a2BOnB1a2B", type: TransitionType.LOCAL},
        {from: "A1a", to : "A", on: "A1a2A_LOCAL", perform: "fromA1a2AOnA1a2A", type: TransitionType.LOCAL},
        {from: "B2", to: "B1a", on: "B22B1a", perform: "fromB22B1aOnB22B1a"},
        {from: "B2", to: "A2",  on: "B22A2", perform: "fromB22A2OnB22A2"},
        {from: "B", to: "B", on: "B2B_SELF", perform: "fromB2BOnB2B"},
        {from: "B2", to: "B2", on: "B22B2_INTER", perform: "fromB22B2OnB22B2", type: TransitionType.INTERNAL},
        {from: "A", to: "B", on: "A2B", perform: "fromA2BOnA2B"},
        {from: "C", to: "D", on: "C2D", perform: "fromC2DOnC2D"},
        {from: "D", to: "C", on: "D2C", perform: "fromD2COnD2C"}
      ]
    },

    // state machine initialize function
    initialize : function() {
      this.callSequence = "";
    },

    methodMissing : function(methodName) {
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

  it("The source and target state are the same", function() {
    var stateMachineInstance = new HierarchicalStateMachine("B");
    stateMachineInstance.start();
    stateMachineInstance.callSequence = "";
    stateMachineInstance.fire("B2B_SELF");
    stateMachineInstance.callSequence.should.equal(".exitB.fromB2BOnB2B.entryB");
  });

  it("There is no target state (internal transition)", function() {
    var stateMachineInstance = new HierarchicalStateMachine("B2");
    stateMachineInstance.start();
    stateMachineInstance.getCurrentState().should.equal("B2");
    stateMachineInstance.callSequence = "";
    stateMachineInstance.fire("B22B2_INTER");
    stateMachineInstance.callSequence.should.equal(".fromB22B2OnB22B2");
  });

  it("The target state is a direct or indirect sub-state of the source state", function() {
    // Perform the transition actions, then traverse the hierarchy from the source state down 
    // to the target state, entering each state along the way. No state is exited.
    var stateMachineInstance = new HierarchicalStateMachine("B");
    stateMachineInstance.start();
    stateMachineInstance.getCurrentState().should.equal("B");
    stateMachineInstance.callSequence = "";
    stateMachineInstance.fire("B2B1a");
    stateMachineInstance.callSequence.should.equal(".fromB2B1aOnB2B1a.entryB1.entryB1a");
  });

  it("The source state is a sub-state of the target state and perform external transition", function() {
    // Traverse the hierarchy from the source up to the target exiting each state along the way. 
    // Then perform transition actions. Finally enter the target state
    var stateMachineInstance = new HierarchicalStateMachine("B1a");
    stateMachineInstance.start();
    stateMachineInstance.getCurrentState().should.equal("B1a");
    stateMachineInstance.callSequence = "";
    stateMachineInstance.fire("B1a2B");
    stateMachineInstance.callSequence.should.equal(".exitB1a.exitB1.exitB.fromB1a2BOnB1a2B.entryB");
   });

  it("The source state is a sub-state of the target state and perform local transition[a]", function() {
    // Traverse the hierarchy from the source up to the target, exiting each state along the way 
    // but not include target state. Then perform transition actions.
    var stateMachineInstance = new HierarchicalStateMachine("B1a");
    stateMachineInstance.start();
    stateMachineInstance.getCurrentState().should.equal("B1a");
    stateMachineInstance.callSequence = "";
    stateMachineInstance.fire("B1a2B_LOCAL");
    stateMachineInstance.callSequence.should.equal(".exitB1a.exitB1.fromB1a2BOnB1a2B");
   });

  it("The source state is a sub-state of the target state and perform local transition[b]", function() {
    var stateMachineInstance = new HierarchicalStateMachine();
    stateMachineInstance.start();
    stateMachineInstance.getCurrentState().should.equal("A1a");
    stateMachineInstance.callSequence = "";
    stateMachineInstance.fire("A1a2A_LOCAL");
    stateMachineInstance.callSequence.should.equal(".exitA1a.exitA1.fromA1a2AOnA1a2A.entryA1.entryA1a");
  });

  it("The source and target state share the same super-state", function() {
    var stateMachineInstance = new HierarchicalStateMachine("B2");
    stateMachineInstance.start();
    stateMachineInstance.getCurrentState().should.equal("B2");
    stateMachineInstance.callSequence = "";
    stateMachineInstance.fire("B22B1a");
    stateMachineInstance.callSequence.should.equal(".exitB2.fromB22B1aOnB22B1a.entryB1.entryB1a");
  });

  it("The source and target states reside at the same level in the hierarchy but do not share the same direct super-state", function() {
    var stateMachineInstance = new HierarchicalStateMachine("B2");
    stateMachineInstance.start();
    stateMachineInstance.getCurrentState().should.equal("B2");
    stateMachineInstance.callSequence = "";
    stateMachineInstance.fire("B22A2");
    stateMachineInstance.callSequence.should.equal(".exitB2.exitB.fromB22A2OnB22A2.entryA.entryA2");
  });

  it("The source state cannot process the event and hand the event to its parent state", function() {
    var stateMachineInstance = new HierarchicalStateMachine();
    stateMachineInstance.start();
    stateMachineInstance.getCurrentState().should.equal("A1a");
    stateMachineInstance.callSequence = "";
    stateMachineInstance.fire("A2B");
    stateMachineInstance.callSequence.should.equal(".exitA1a.exitA1.exitA.fromA2BOnA2B.entryB");
  });

  it("The shallow state enters into its last active sub-state. The sub-state itself enters its initial sub-state "+
    "and so on until the innermost nested state is reached", function() {
    var stateMachineInstance = new HierarchicalStateMachine("D1a");
    stateMachineInstance.start();
    stateMachineInstance.getCurrentState().should.equal("D1a");
    stateMachineInstance.fire("D2C");
    stateMachineInstance.getCurrentState().should.equal("C");
    stateMachineInstance.fire("C2D");
    stateMachineInstance.getCurrentState().should.equal("D1");
  });

  it("The state enters into its last active sub-state. The sub-state itself enters into-its last active state "+
    "and so on until the innermost nested state is reached", function() {
    var stateMachineInstance = new HierarchicalStateMachine("C1b");
    stateMachineInstance.start();
    stateMachineInstance.getCurrentState().should.equal("C1b");
    stateMachineInstance.fire("C2D");
    stateMachineInstance.getCurrentState().should.equal("D");
    stateMachineInstance.fire("D2C");
    stateMachineInstance.getCurrentState().should.equal("C1b");
  });

});