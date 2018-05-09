var StompUtils = require('./stomp-utils');

var ServerFrame = {
  CONNECTED: function (socket, heartbeat, serverName) {
    return StompUtils.sendCommand(socket, 'CONNECTED', {
      session: socket.sessionId,
      server: serverName,
      'heart-beat': heartbeat,
      version: '1.1'
    });
  },
  
  MESSAGE: function (socket, frame) {
    return StompUtils.sendCommand(socket, 'MESSAGE', frame.header, frame.body);
  },
  
  RECEIPT: function (socket, receipt) {
    return StompUtils.sendCommand(socket, 'RECEIPT', {
      'receipt-id': receipt
    });
  },
  
  ERROR: function (socket, message, description) {
    var receipt = typeof description === 'object' ? description.headers.receipt : null;
    var body = typeof description === 'object' && description.toReasonString ?
      "--- BEGIN REASON ---\n" + description.toReasonString() + "\n--- END REASON ---" :
      description.toString();
    var len = body !== undefined ? body.length : 0;
    var headers = {
      message: message,
      'content-type': 'text/plain',
      'content-length': len
    };

    if (receipt) {
      headers['receipt-id'] = receipt;
    }
    return StompUtils.sendCommand(socket, 'ERROR', headers, body);
  }
};

function FrameHandler(stompServer) {
  function callHandler(handler) {
    var args = Array.prototype.slice.call(arguments, 1);
    try {
      return Promise.resolve(handler.apply(stompServer, args));
    } catch (err) {
      return Promise.reject(err);
    }
  }
  this.CONNECT = function (socket, frame) {
    // setup heart-beat feature
    var rawHeartbeat = frame.headers['heart-beat'];
    var clientHeartbeat = [0, 0];
    if (rawHeartbeat) {
      clientHeartbeat = rawHeartbeat.split(',').map(function(x) { return parseInt(x); });
    }

    // default server heart-beat answer
    serverHeartbeat = [0, 0];

    // check preferred heart-beat direction: client → server
    if (clientHeartbeat[0] > 0 && stompServer.conf.heartbeat[1] > 0) {
      serverHeartbeat[1] = Math.max(clientHeartbeat[0], stompServer.conf.heartbeat[1]);
      stompServer.heartbeatOn(socket, serverHeartbeat[1], false);
    }
    // check non-preferred heart-beat direction: server → client
    else if (clientHeartbeat[1] > 0 && stompServer.conf.heartbeat[0] > 0) {
      serverHeartbeat[0] = Math.max(clientHeartbeat[1], stompServer.conf.heartbeat[0]);
      stompServer.heartbeatOn(socket, serverHeartbeat[0], true);
    }

    return callHandler(stompServer.onClientConnected, socket, {
      heartbeat: clientHeartbeat,
      headers: frame.headers
    }).then(function (accepted) {
      return accepted ?
        ServerFrame.CONNECTED(socket, serverHeartbeat.join(','), stompServer.conf.serverName) :
        ServerFrame.ERROR(socket, "CONNECTION ERROR", "CONNECTION ERROR");
    });
  };
  
  this.DISCONNECT = function (socket, frame) {
    var receipt = frame.headers.receipt;
    return callHandler(stompServer.onDisconnect, socket, receipt)
      .then(function (accepted) {
        return accepted?
          ServerFrame.RECEIPT(socket, receipt) :
          ServerFrame.ERROR(socket, 'DISCONNECT ERROR', receipt);
      });
  };
  
  this.SUBSCRIBE = function (socket, frame) {
    var dest = frame.headers.destination;
    var ack = 'auto' || frame.headers.ack;
    return callHandler(stompServer.onSubscribe, socket, {
      dest: dest,
      ack: ack,
      id: frame.headers.id
    }).then(function (accepted) {
      if (!accepted) {
        return ServerFrame.ERROR(socket, 'SUBSCRIBE ERROR', dest);
      }
    });
  };
  
  this.UNSUBSCRIBE = function (socket, frame) {
    var id = frame.headers.id;
    return callHandler(stompServer.onUnsubscribe, socket, id)
      .then(function (accepted) {
        if (!accepted) {
          return ServerFrame.ERROR(socket, 'UNSUBSCRIBE ERROR', id);
        }
      });
  };
  
  this.SEND = function (socket, frame) {
    var dest = frame.headers.destination;
    var receipt = frame.headers.receipt;
    return callHandler(stompServer.onSend, socket, {
      dest: dest,
      frame: frame
    }).then(function (res) {
      if (res && receipt) {
        return ServerFrame.RECEIPT(socket, receipt);
      } else if (!res) {
        return ServerFrame.ERROR(socket, 'Send error', frame);
      }
    });
  };
}

module.exports = {
  StompUtils: StompUtils,
  ServerFrame: ServerFrame,
  FrameHandler: FrameHandler,
  genId: StompUtils.genId
};
