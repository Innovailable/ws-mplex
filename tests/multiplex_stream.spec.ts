import { expect, use } from "chai";

import * as sinon from  "sinon";
import * as sinonChai from "sinon-chai";

import "chai-bytes";

use(sinonChai);
use(require("chai-bytes"));

import { MultiplexShim } from "../src/multiplex_shim";
import { MultiplexStream } from "../src/multiplex_stream";
import { ResponseCb } from "../src/types";

function createBuffer(num: number = 0, size: number = 4) {
  const data = new Buffer(size);
  data.fill(num);
  return data;
}

function ignoreCb(err?: Error | null) {
  if(err) {
    throw err;
  }
}

function zip<A,B>(arr1: Array<A>, arr2: Array<B>) {
  return arr1.map((k, i): [A, B] => [k, arr2[i]]);
}

describe("MultiplexStream", () => {
  describe("read", () => {
    const shim: MultiplexShim = {
      write: (data, cb) => null,
      send_close: (data, cb) => null,
      release: () => null,
    };

    let stream: MultiplexStream;

    beforeEach(() => {
      stream = new MultiplexStream(shim, {
        highWaterMark: 32,
      });
    });

    afterEach(() => {
      stream.destroy();
    });

    it("should read() a single chunk", () => {
      const write = createBuffer();
      shim.receive!(write, ignoreCb);
      const read = stream.read();
      expect(read).equalBytes(write);
    });

    it("should emit a single chunk", (done) => {
      const write = createBuffer();

      stream.on("data", (read) => {
        expect(read).to.equalBytes(write);
        done();
      });

      shim.receive!(write, ignoreCb);
    });

    it("should emit end", (done) => {
      stream.on("data", () => {
        throw new Error("Unexpected data received")
      });

      stream.on("end", done);

      shim.receive!(null, ignoreCb)
    });

    it("should emit multiple chunks and end in order", (done) => {
      const writes = Array(5).fill(0).map((n, i) => createBuffer(i));
      const reads = Array<Buffer>();

      stream.on("data", (data) => {
        reads.push(data);
      });

      stream.on("end", () => {
        for(const [write, read] of zip(writes, reads)) {
          expect(read).to.equalBytes(write);
        }

        done();
      });

      for(const write of writes) {
        shim.receive!(write, ignoreCb)
      }

      shim.receive!(null, ignoreCb)
    });

    it("should emit multiple big chunks and end in order", (done) => {
      // TODO reword into something testing high water mark
      const writes = Array(10).fill(0).map((n, i) => createBuffer(i, 16));
      const reads = Array<Buffer>();

      stream.on("data", (data) => {
        reads.push(data);
      });

      stream.on("end", () => {
        for(const [write, read] of zip(writes, reads)) {
          expect(read).to.equalBytes(write);
        }

        done();
      });

      for(const write of writes) {
        shim.receive!(write, ignoreCb)
      }

      shim.receive!(null, ignoreCb)
    });

    it("should call shim callback on read()", () => {
      const spy = sinon.spy();

      const write = createBuffer();
      shim.receive!(write, spy);
      const read = stream.read();

      expect(read).to.equalBytes(write);
      expect(spy).to.have.been.calledOnce;
    });

    it("should call shim receive callbacks only after written to buffer", () => {
      // TODO reword into something testing high water mark
      const writes = Array(5).fill(0).map((n, i) => createBuffer(i, 20));
      const reads = Array<Buffer>();
      const callbacks = Array<sinon.SinonSpy>();

      for(const write of writes) {
        const cb = sinon.spy();
        shim.receive!(write, cb)
        callbacks.push(cb);
      }

      shim.receive!(null, ignoreCb)

      for(const cb of callbacks) {
        expect(cb).to.not.have.been.calledOnce;
      }

      expect(stream.read(20)).to.equalBytes(writes[0]);

      expect(callbacks[0]).to.have.been.calledOnce;
      expect(callbacks[1]).to.have.been.calledOnce;
      expect(callbacks[2]).to.not.have.been.calledOnce;
      expect(callbacks[3]).to.not.have.been.calledOnce;
      expect(callbacks[4]).to.not.have.been.calledOnce;

      expect(stream.read(20)).to.equalBytes(writes[1]);

      expect(callbacks[2]).to.have.been.calledOnce;
      expect(callbacks[3]).to.not.have.been.calledOnce;
      expect(callbacks[4]).to.not.have.been.calledOnce;

      expect(stream.read(20)).to.equalBytes(writes[2]);

      expect(callbacks[3]).to.have.been.calledOnce;
      expect(callbacks[4]).to.not.have.been.calledOnce;

      expect(stream.read(20)).to.equalBytes(writes[3]);
      expect(stream.read(20)).to.equalBytes(writes[4]);
      expect(stream.read(20)).to.equal(null);

      expect(callbacks[4]).to.have.been.calledOnce;
    });

    it("should report error to shim read if closed before being sent", (done) => {
      const write = createBuffer();

      stream.destroy();

      shim.receive!(write, (err) => {
        expect(err).to.not.be.null;
        done();
      });
    });

    it("should report error to shim read if closed before read", (done) => {
      const write = createBuffer();

      shim.receive!(write, (err) => {
        expect(err).to.not.be.null;
        done();
      });

      stream.destroy();
    });
  });

  describe("write", () => {
    const written = Array<Buffer|null>();
    const callbacks = Array<ResponseCb>();

    const shim: MultiplexShim = {
      write: (data, cb) => {
        written.push(data);
        callbacks.push(cb);
      },
      send_close: (data, cb) => null,
      release: () => null,
    };

    let stream: MultiplexStream;

    beforeEach(() => {
      stream = new MultiplexStream(shim, {
        writeMaxOutstanding: 32,
        highWaterMark: 32,
      });
    });

    afterEach(() => {
      stream.destroy();
      written.length = 0;
      callbacks.length = 0;
    });

    it("should call shim", () => {
      const data = createBuffer();
      stream.write(data);
      expect(written[0]).to.equal(data);;
    });

    it("should stop sending if too many outstanding", () => {
      const data = createBuffer(0, 20);

      stream.write(data);
      stream.write(data);
      stream.write(data);

      expect(written.length).to.equal(2);
    });

    it("should continue sending after shim callback called", () => {
      const data = createBuffer(0, 20);

      stream.write(data);
      // 20 bytes outstanding, sent
      stream.write(data);
      // 40 bytes outstanding, sent
      stream.write(data);
      // too many outstanding, not sent

      expect(written.length).to.equal(2);

      const cb = callbacks.shift();
      cb!();

      expect(written.length).to.equal(3);
    });

    it("should return false if outstanding and buffer filled", () => {
      const data = createBuffer(0, 20);

      expect(stream.write(data)).to.be.true;
      expect(stream.writableLength).to.equal(0);

      expect(stream.write(data)).to.be.true;
      expect(stream.writableLength).to.equal(20);

      expect(stream.write(data)).to.be.false;
      expect(stream.writableLength).to.equal(40);
    });
  });
});
