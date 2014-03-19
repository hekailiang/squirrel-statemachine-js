/*global require, module, it, describe*/
/*jslint nomen: true*/
var should = require('chai').should(),
    expect = require('chai').expect,
    squirrel = require('../index'),
    StateMachine = squirrel.StateMachine,
    Events = squirrel.Events;

describe('#StateMachine basic function', function() {
  'use strict';
  var SimpleStateMachine = StateMachine.extend({
    // state machine definition
    machine : {
      states : {
        A : { onEntry: "enterA", onExit: "exitA", initial:true },
        B : { onEntry: "enterB", onExit: "exitB" },
        F : { onEntry: function() { this.callSequence += ".enterF"; },
              onExit:  function() { this.callSequence += ".exitF"; },
              final: true }
      },

      transitions : [
        { from : "A", to : "B", on : "A2B", perform : "fromAToB" },
        { from : "B", to : "A", on : "B2A", perform : function() { this.callSequence += ".fromBToA"; } },
        { from : "B", to : "C", on : "B2C", perform : function() { this.fire("C2D"); this.fire("D2E"); } },
        { from : "C", to : "D", on : "C2D" },
        { from : "D", to : "E", on : "D2E" },
        { from : "D", to : "F", on : "D2F", when : function(context) {return context>10;} },
        { from : "A", to : "F", on : "END" }
      ]
    },

    // state machine initialize function
    initialize : function() {
      this.callSequence = "";
    },

     // state machine actions
    enterA : function() {
       this.callSequence += ".enterA";
    },

    methodMissing : function(methodName) {
      this.callSequence += "."+methodName;
    }
  });

  it("A simple state machine should enter its initial states and status should be idle when started",
    function() {
      var stateMachineInstance = new SimpleStateMachine("A");
      // expect(stateMachineInstance.getCurrentState()).to.be.null;
      stateMachineInstance.start();
      stateMachineInstance.callSequence.should.equal(".enterA");
      stateMachineInstance.getCurrentState().should.equal("A");
      stateMachineInstance.getStatus().should.equal(squirrel.StateMachineStatus.IDLE);
  });

  it("A simple state machine should throw error when it is not started and its options 'isAutoStartEnabled' set to false",
    function() {
      var fireUnstartedFsmFunc = function() {
        var stateMachineInstance = new SimpleStateMachine("A", {isAutoStartEnabled : false, isDebugInfoEnabled: true});
        stateMachineInstance.fire("A2B");
      };
      expect(fireUnstartedFsmFunc).to.Throw(/not running/);
  });

  it("A simple state machine should auto terminated when entering in final state with option 'isAutoTerminate' set to true.",
    function() {
      var stateMachineInstance = new SimpleStateMachine();
      stateMachineInstance.fire("END");
      stateMachineInstance.callSequence.should.equal(".enterA.exitA.enterF");
      stateMachineInstance.getStatus().should.equal(squirrel.StateMachineStatus.TERMINATED);
  });

  it("A simple external transition should include old state exit, transition perform and new state entry",
    function() {
      var stateMachineInstance = new SimpleStateMachine(),
      stateMachineInstance2 = new SimpleStateMachine("B");

      stateMachineInstance.fire("A2B");
      stateMachineInstance.callSequence.should.equal(".enterA.exitA.fromAToB.enterB");

      stateMachineInstance2.fire("B2A");
      stateMachineInstance2.callSequence.should.equal(".enterB.exitB.fromBToA.enterA");
  });

  it("A simple conditional transition should be completed only when condition satisfied", function() {
    var stateMachineInstance = new SimpleStateMachine("D");
    stateMachineInstance.fire("D2F", 5);
    stateMachineInstance.getCurrentState().should.equal("D");
    stateMachineInstance.fire("D2F", 15);
    stateMachineInstance.getCurrentState().should.equal("F");
  });

  it("Nested fired events should be processed after processing current event finished", function() {
    var stateMachineInstance = new SimpleStateMachine("B");
    stateMachineInstance.fire("B2C");
    stateMachineInstance.getCurrentState().should.equal("E");
  });

  it("A simple state machine should be able to be extended from parent state machine with out affect parent", function() {
    var SimpleStateMachineEx = SimpleStateMachine.extend({
      machine : {
        initial : "B",
        states : {
          A : { onEntry: "enterAFromEx" },
          B : { onExit: "exitBFromEx"}
        }
      },

      enterAFromEx : function() {
        this.callSequence += ".enterAFromEx";
      },

      exitBFromEx : function() {
        this.callSequence += ".exitBFromEx";
      }
    }),

    simpleStateMachineInstance = new SimpleStateMachine(),
    simpleStateMachineExInstance = new SimpleStateMachineEx();

    simpleStateMachineInstance.start();
    simpleStateMachineInstance.getCurrentState().should.equal("A");
    simpleStateMachineInstance.fire("A2B");
    simpleStateMachineInstance.callSequence.should.equal(".enterA.exitA.fromAToB.enterB");

    simpleStateMachineExInstance.start();
    simpleStateMachineExInstance.getCurrentState().should.equal("B");
    simpleStateMachineExInstance.fire("B2A");
    simpleStateMachineExInstance.callSequence.should.equal(".enterB.exitBFromEx.exitB.fromBToA.enterAFromEx.enterA");
  });

  it("A state machine action invoke order should be able to adjust through priority", function() {
    var SimpleStateMachineEx = SimpleStateMachine.extend({
      machine : {
        initial : "B",
        states : {
          A : { onEntry: "enterAFromEx:0" }, // invoked after original entry method
          B : { onExit: "exitBFromEx:0"}     // invoked after original entry method
        }
      },

      enterAFromEx : function() {
        this.callSequence += ".enterAFromEx";
      },

      exitBFromEx : function() {
        this.callSequence += ".exitBFromEx";
      }
    }),
    simpleStateMachineExInstance = new SimpleStateMachineEx();
    simpleStateMachineExInstance.start();
    simpleStateMachineExInstance.getCurrentState().should.equal("B");
    simpleStateMachineExInstance.fire("B2A");
    simpleStateMachineExInstance.callSequence.should.equal(".enterB.exitB.exitBFromEx.fromBToA.enterA.enterAFromEx");
    // console.log(JSON.stringify(simpleStateMachineExInstance.getEffectiveDefinition(), null, 2));
  });

  it("A extended state machine should be able to override parent state machine action method", function() {
    var SimpleStateMachineEx = SimpleStateMachine.extend({
      enterA : function() {
        this.callSequence += ".enterAFromEx";
        SimpleStateMachineEx.__super__.enterA.call(this, arguments);
      }
    }),
    simpleStateMachineExInstance = new SimpleStateMachineEx();
    simpleStateMachineExInstance.start();
    simpleStateMachineExInstance.getCurrentState().should.equal("A");
    simpleStateMachineExInstance.fire("A2B");
    simpleStateMachineExInstance.callSequence.should.equal(".enterAFromEx.enterA.exitA.fromAToB.enterB");
  });

  it("A simple state machine will trigger various kind of transition events during state transition", function() {
    var simpleStateMachineInstance = new SimpleStateMachine(), result="";
    simpleStateMachineInstance.on(Events.TRANSITION_BEGIN, function(fromStateId, event) {
      result += "[Begin] from: "+fromStateId+", on: "+event+"; ";
    }).bind(Events.TRANSITION_COMPLETE, function(fromStateId, toStateId, event) {
      result += "[Completed] from: "+fromStateId+", to: "+toStateId+", on: "+event+";";
    });
    simpleStateMachineInstance.fire("A2B");
    result.should.equal("[Begin] from: A, on: A2B; [Completed] from: A, to: B, on: A2B;");
  });

});