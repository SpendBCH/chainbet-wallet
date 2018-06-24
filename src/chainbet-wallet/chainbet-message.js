import network from './network'
import cbContract  from './chainbet-contract'

let BITBOXCli = require('bitbox-cli/lib/bitbox-cli').default;
let BITBOX = new BITBOXCli();

class ChainbetMessage {
    static async sendPhase1(wallet, type, amount, hostCommitment, targetAddress) {
        let script = this._encodePhase1(type, amount, hostCommitment, targetAddress)
        return await this._sendMessage(wallet, script)
    }

    static async sendPhase2(wallet, betTxId, clientPubKey, clientCommitment) {
        let script = this._encodePhase2(betTxId, clientPubKey, clientCommitment)
        return await this._sendMessage(wallet, script)
    }

    static async sendPhase3(wallet, betTxId, clientTxId, hostEscrowTxId, hostPubKey) {
        let script = this._encodePhase3(betTxId, clientTxId, hostEscrowTxId, hostPubKey)
        return await this._sendMessage(wallet, script)
    }

    static async sendPhase4(wallet, pubKeys, hostCommitment, clientCommitment, hostEscrowTxId, clientEscrowTxId, betTxId, amount) {
        let hostEscrowScript = cbContract.encodeHostEscrow(pubKeys[0], hostCommitment, pubKeys[1])
        let clientEscrowScript = cbContract.encodeClientEscrow(pubKeys[1], pubKeys[0])
        let betContractScript = cbContract.encodeBetContract(pubKeys[0], pubKeys[1], hostCommitment, clientCommitment)
        let clientSigs = cbContract.encodeClientSignatures(wallet, hostEscrowScript, clientEscrowScript,
          betContractScript, hostEscrowTxId, clientEscrowTxId, amount)

        let script = this._encodePhase4(betTxId, clientEscrowTxId, clientSigs[0], clientSigs[1])
        return await this._sendMessage(wallet, script)
    }

    static async sendPhase6(wallet, betTxId, secret) {
        let script = this._encodePhase6(betTxId, secret)
        return await this._sendMessage(wallet, script)
    }

    static async _sendMessage(wallet, script) {
        let utxo = await network.getUtxo(wallet.address)
        let transactionBuilder = new BITBOX.TransactionBuilder('bitcoincash')

        transactionBuilder.addInput(utxo.txid, utxo.vout)

        let byteCount = BITBOX.BitcoinCash.getByteCount({ P2PKH: 1 }, { P2SH: 1 }) + Buffer.byteLength(script) + 20
        let satoshisAfterFee = utxo.satoshis - byteCount

        transactionBuilder.addOutput(script, 0)
        transactionBuilder.addOutput(utxo.legacyAddress, satoshisAfterFee)

        let key = BITBOX.ECPair.fromWIF(wallet.wif)

        let redeemScript
        transactionBuilder.sign(0, key, redeemScript, transactionBuilder.hashTypes.SIGHASH_ALL, utxo.satoshis)

        let hex = transactionBuilder.build().toHex()
        return await network.sendRawAsync(hex)
    }

    static decode(op_return) {
      let data = op_return.split("00424554");
      let buf = Buffer.from(data[1].trim(), 'hex');
      let version = buf[0];
      let phase = buf[1];
      let results = { version: version, phase: phase };
      if(phase === 0x01) {
        // type
        results.type = buf[2];
        // amount
        results.amount = parseInt(buf.slice(3,11).toString('hex'), 16);
        // host commitment
        results.hostCommitment = buf.slice(11, 31).toString('hex')
        // // target address
        if (buf.length > 31)
            results.address = buf.slice(31).toString('hex');
      } else if(phase === 0x02) {
        // Bet Txn Id
        results.betTxId = buf.slice(2, 34).toString('hex');
        // Multi-sig Pub Key
        results.multisigPubKey = buf.slice(34, 67).toString('hex');
        // Client Commitment
        results.clientCommitment = buf.slice(67).toString('hex');
      } else if(phase === 0x03) {
        // 32 byte Bet Txn Id
        results.betTxId = buf.slice(2, 34).toString('hex');
        // 32 byte Participant Txn Id
        results.clientTxId = buf.slice(34, 66).toString('hex');
        // 32 byte Host P2SH txid
        results.hostEscrowTxId = buf.slice(66, 98).toString('hex');
        // 33 byte Host (Alice) multsig pubkey
        results.hostPubKey = buf.slice(98).toString('hex');
      } else if(phase === 0x04) {
        // 32 byte Bet Txn Id
        results.betTxId = buf.slice(2, 34).toString('hex');
        // 32 byte Client Tx Id
        results.clientEscrowTxId = buf.slice(34, 66).toString('hex');
        // 72 byte Participant Signature 1
        results.clientSig1 = buf[66] ? buf.slice(66, 138).toString('hex') : buf.slice(67, 138).toString('hex')
        // 72 byte Participant Signature 2
        results.clientSig2 = buf[138] ? buf.slice(138).toString('hex') : buf.slice(139).toString('hex')
      } else if(phase === 0x06) {
        // 32 byte Bet Txn Id
        results.betTxId = buf.slice(2, 34).toString('hex');
        // 32 byte Secret Value
        results.clientSecret = buf.slice(34, 66).toString('hex');
      }
      return results;
    }

    static _encodePhase1(type, amount, hostCommitment, targetAddress) {
      // Set Phase 1 ChainBet payload length
      var pushdatalength = 51 // 51 bytes with optional targetAddress
      if(targetAddress == undefined) {
        pushdatalength = 31   // 11 bytes without targetAddress
      }

      let script = [
        BITBOX.Script.opcodes.OP_RETURN,
        // pushdata, 4 bytes
        0x04,
        // 4 byte Terab prefix
        0x00,
        0x42,
        0x45,
        0x54,
        BITBOX.Script.opcodes.OP_PUSHDATA1,
        pushdatalength,
        // 1 byte version id
        0x01,
        // 1 byte phase id
        0x01,
        // 1 byte bet type id
        type,
      ];

      // add 8 byte amount
      amount = this._amount2Hex(amount)
      amount.forEach((item, index) => {
        script.push(item);
      })

      // add host commitment
      hostCommitment.forEach((item) => script.push(item))

      // add optional 20 byte target address
      if(targetAddress != undefined) {
        // optional 20 byte HASH160 public key hash
        let addr = BITBOX.Crypto.hash160(targetAddress);
        addr.forEach((item, index) => { script.push(item); })
      }

      let encoded = BITBOX.Script.encode(script);
      return encoded;
    }

    static _encodePhase2(betTxId, multisigPubKey, clientCommitment) {

      // set Phase 2 ChainBet payload length
      var pushdatalength = 87

      let script = [
        BITBOX.Script.opcodes.OP_RETURN,
        // pushdata, 4 bytes
        0x04,
        // 4 byte Terab prefix
        0x00,
        0x42,
        0x45,
        0x54,
        BITBOX.Script.opcodes.OP_PUSHDATA1,
        pushdatalength,
        // 1 byte version id
        0x01,
        // 1 byte phase id
        0x02,
      ];

      // 32 byte betTxId hex
      betTxId = Buffer(betTxId, 'hex')
      betTxId.forEach((item) => { script.push(item) })

      // 33 byte participant (Bob) multisig Pub Key hex
      multisigPubKey = Buffer(multisigPubKey, 'hex')
      multisigPubKey.forEach((item) => { script.push(item) })

      // add client commitment
      clientCommitment.forEach((item) => script.push(item))

      return BITBOX.Script.encode(script)
    }

    static _encodePhase3(betTxId, participantTxId, hostP2SHTxId, hostMultisigPubKey) {

      // set Phase 3 ChainBet payload length to 131 bytes
      var pushdatalength = 0x83

      let script = [
        BITBOX.Script.opcodes.OP_RETURN,
        // pushdata, 4 bytes
        0x04,
        // 4 byte prefix
        0x00,
        0x42,
        0x45,
        0x54,
        BITBOX.Script.opcodes.OP_PUSHDATA1,
        pushdatalength,
        // 1 byte version id
        0x01,
        // 1 byte phase id
        0x03,
      ];

      // 32 byte bet tx id
      betTxId = Buffer(betTxId, 'hex')
      betTxId.forEach((item, index) => { script.push(item); })

      // 32 byte participant tx id
      participantTxId = Buffer(participantTxId, 'hex')
      participantTxId.forEach((item, index) => { script.push(item); })

      // 32 byte host P2SH id
      hostP2SHTxId = Buffer(hostP2SHTxId, 'hex')
      hostP2SHTxId.forEach((item, index) => { script.push(item); })

      // 33 byte host (Alice) Multisig Pub Key
      hostMultisigPubKey = Buffer(hostMultisigPubKey, 'hex')
      hostMultisigPubKey.forEach((item, index) => { script.push(item); })

      return BITBOX.Script.encode(script)
    }

    static _encodePhase4(betTxId, clientTxId, clientSig1, clientSig2) {

      // set Phase 4 ChainBet payload length to 210 bytes
      var pushdatalength = 0xd2

      let script = [
        BITBOX.Script.opcodes.OP_RETURN,
        // pushdata, 4 bytes
        0x04,
        // 4 byte prefix
        0x00,
        0x42,
        0x45,
        0x54,
        BITBOX.Script.opcodes.OP_PUSHDATA1,
        pushdatalength,
        // 1 byte version id
        0x01,
        // 1 byte phase id
        0x04,
      ];

      // 32 byte bet tx id
      betTxId = Buffer(betTxId, 'hex')
      betTxId.forEach((item, index) => { script.push(item); })

      // 32 byte Participant tx id
      clientTxId = Buffer(clientTxId, 'hex')
      clientTxId.forEach((item, index) => { script.push(item); })

      // 72 byte Participant signature 1
      clientSig1 = Buffer(clientSig1, 'hex')
      if (clientSig1.length == 71) script.push(0x00)
      clientSig1.forEach((item, index) => { script.push(item); })

      // 72 byte Participant signature 2
      clientSig2 = Buffer(clientSig2, 'hex')
      if (clientSig2.length == 71) script.push(0x00)
      clientSig2.forEach((item, index) => { script.push(item); })

      return BITBOX.Script.encode(script)
    }

    static _encodePhase6(betTxId, secretValue) {

      // set Phase 6 ChainBet payload length to 66 bytes
      var pushdatalength = 0x42

      let script = [
        BITBOX.Script.opcodes.OP_RETURN,
        // pushdata, 4 bytes
        0x04,
        // 4 byte prefix
        0x00,
        0x42,
        0x45,
        0x54,
        BITBOX.Script.opcodes.OP_PUSHDATA1,
        pushdatalength,
        // 1 byte version id
        0x01,
        // 1 byte phase id
        0x06,
      ]

      // 32 byte bet txn id
      betTxId = Buffer(betTxId, 'hex')
      betTxId.forEach((item) => { script.push(item) })

      // 32 byte Secret value
      secretValue = secretValue
      secretValue.forEach((item) => { script.push(item) })

      return BITBOX.Script.encode(script)
    }

    // get big-endian hex from satoshis
    static _amount2Hex(amount) {
      var hex = amount.toString(16)
      const len = hex.length
      for (let i = 0; i < 16 - len; i++) {
        hex = '0' + hex;
      }
      let buf = Buffer.from(hex, 'hex')
      return buf
    }
}

export default ChainbetMessage
