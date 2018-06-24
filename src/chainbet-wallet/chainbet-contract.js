import network from './network'

let BITBOXCli = require('bitbox-cli/lib/bitbox-cli').default;
let BITBOX = new BITBOXCli();

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

class ChainbetContract {
    static async fundHostEscrow(wallet, multisigPubKeys, amount, hostCommitment) {
        let script = this.encodeHostEscrow(multisigPubKeys[0], hostCommitment, multisigPubKeys[1])
        return await this._fundEscrow(wallet, amount, script)
    }

    static async fundClientEscrow(wallet, multisigPubKeys, amount) {
        let script = this.encodeClientEscrow(multisigPubKeys[1], multisigPubKeys[0])
        return await this._fundEscrow(wallet, amount, script)
    }

    static async fundBetContract(wallet, pubKeys, amount, hostCommitment, clientCommitment, hostEscrowTxId, clientEscrowTxId, clientSig1, clientSig2, hostSecret) {
        let hostEscrowScript = this.encodeHostEscrow(pubKeys[0], hostCommitment, pubKeys[1])
        let clientEscrowScript = this.encodeClientEscrow(pubKeys[1], pubKeys[0])
        let betContractScript = this.encodeBetContract(pubKeys[0], pubKeys[1], hostCommitment, clientCommitment)

        let hostKey = BITBOX.ECPair.fromWIF(wallet.wif)
        let transactionBuilder = new BITBOX.TransactionBuilder('bitcoincash');

        let hashType = 0xc1
        let byteCount = BITBOX.BitcoinCash.getByteCount({ P2PKH: 1 }, { P2SH: 1 })
        let satoshisAfterFee = (amount*2) - byteCount - 750
        transactionBuilder.addInput(hostEscrowTxId, 0)
        transactionBuilder.addInput(clientEscrowTxId, 0)

        // Determine bet address
        let p2sh_hash160 = BITBOX.Crypto.hash160(betContractScript);
        let scriptPubKey = BITBOX.Script.scriptHash.output.encode(p2sh_hash160);
        let betAddress = BITBOX.Address.fromOutputScript(scriptPubKey)
        transactionBuilder.addOutput(betAddress, satoshisAfterFee);

        let tx = transactionBuilder.transaction.buildIncomplete();

        // Sign host escrow
        let sigHash = tx.hashForWitnessV0(0, hostEscrowScript, amount, hashType)
        let hostSig = hostKey.sign(sigHash).toScriptSignature(hashType)

        let scriptSig = []

        // multisig off by one fix
        scriptSig.push(BITBOX.Script.opcodes.OP_0)

        // host signature
        scriptSig.push(hostSig.length)
        hostSig.forEach((item) => { scriptSig.push(item) })

        // client signature
        scriptSig.push(clientSig1.length)
        clientSig1.forEach((item) => { scriptSig.push(item) })
        
        // Host secret
        scriptSig.push(hostSecret.length);
        hostSecret.forEach((item) => { scriptSig.push(item) })

        // MakeBet mode
        scriptSig.push(0x51)

        if (hostEscrowScript.length > 75) scriptSig.push(0x4c)
        scriptSig.push(hostEscrowScript.length)
        hostEscrowScript.forEach((item) => { scriptSig.push(item) })
        
        scriptSig = Buffer(scriptSig)
        tx.setInputScript(0, scriptSig)

        // Sign client escrow
        let sigHash2 = tx.hashForWitnessV0(1, clientEscrowScript, amount, hashType)
        let hostSig2 = hostKey.sign(sigHash2).toScriptSignature(hashType)

        let scriptSig2 = []

        // multisig off by one fix
        scriptSig2.push(BITBOX.Script.opcodes.OP_0)

        // host signature
        scriptSig2.push(hostSig2.length)
        hostSig2.forEach((item) => { scriptSig2.push(item); })

        // client signature
        scriptSig2.push(clientSig2.length)
        clientSig2.forEach((item) => { scriptSig2.push(item); })

        // MakeBet mode
        scriptSig2.push(0x51)

        if (clientEscrowScript.length > 75) scriptSig2.push(0x4c)
        scriptSig2.push(clientEscrowScript.length)
        clientEscrowScript.forEach((item) => { scriptSig2.push(item); });
        
        scriptSig2 = Buffer(scriptSig2)
        tx.setInputScript(1, scriptSig2)
        
        let hex = tx.toHex()
        return await network.sendRawAsync(hex)
    }

    static async claimWinHostSecret(wallet, pubKeys, hostCommitment, clientCommitment, contractTxId, winAmount, clientSecret) {
        let contractScript = this.encodeBetContract(pubKeys[0], pubKeys[1], hostCommitment, clientCommitment)

        let hostKey = BITBOX.ECPair.fromWIF(wallet.wif)
        let transactionBuilder = new BITBOX.TransactionBuilder('bitcoincash')
        let hashType = 0xc1
        let byteCount = BITBOX.BitcoinCash.getByteCount({ P2PKH: 1 }, { P2SH: 1 })
        let satoshisAfterFee = winAmount - byteCount - 800

        transactionBuilder.addInput(contractTxId, 0)
        transactionBuilder.addOutput(wallet.address, satoshisAfterFee)

        let tx = transactionBuilder.transaction.buildIncomplete()

        // Sign bet tx
        let sigHash = tx.hashForWitnessV0(0, contractScript, winAmount, hashType)
        let hostSig = hostKey.sign(sigHash).toScriptSignature(hashType)

        let scriptSig = []

        // host signature
        scriptSig.push(hostSig.length)
        hostSig.forEach((item) => { scriptSig.push(item) })

        // client secret
        scriptSig.push(clientSecret.length)
        clientSecret.forEach((item) => { scriptSig.push(item) })

        // Host wins with client secret mode
        scriptSig.push(0x51)
        scriptSig.push(0x51)

        if (contractScript.length > 75) scriptSig.push(0x4c)
        scriptSig.push(contractScript.length)
        contractScript.forEach((item) => { scriptSig.push(item) })
        
        scriptSig = Buffer(scriptSig)
        tx.setInputScript(0, scriptSig)
        
        let hex = tx.toHex()
        return await network.sendRawAsync(hex)
    }

    static async claimWinClient(wallet, pubKeys, hostCommitment, clientCommitment, winAmount, clientSecret) {
        let rtn = { won: false }
        let contractScript = this.encodeBetContract(pubKeys[0], pubKeys[1], hostCommitment, clientCommitment)

        // VERY rough check for client win
        let p2sh_hash160 = BITBOX.Crypto.hash160(contractScript)
        let scriptPubKey = BITBOX.Script.scriptHash.output.encode(p2sh_hash160)
        let betAddress = BITBOX.Address.fromOutputScript(scriptPubKey)

        let contractTxId
        for (let i = 0; i < 5; i++) {
            await sleep(3000)
            let utxos = await network.getAllUtxo(betAddress)
            if (utxos === undefined) continue
            let utxo = utxos.find((i) => i.satoshis = winAmount)
            if (utxo !== undefined) {
                contractTxId = utxo.txid
                await sleep(3000)
                break
            }
        }
        if (contractTxId === undefined) return rtn

        let hostSecret = await network.getHostSecret(contractTxId)
        await sleep(3000)

        let clientKey = BITBOX.ECPair.fromWIF(wallet.wif)
        let transactionBuilder = new BITBOX.TransactionBuilder('bitcoincash')

        let hashType = 0xc1
        let byteCount = BITBOX.BitcoinCash.getByteCount({ P2PKH: 1 }, { P2SH: 1 })
        let satoshisAfterFee = winAmount - byteCount - 800
        transactionBuilder.addInput(contractTxId, 0)
        transactionBuilder.addOutput(wallet.address, satoshisAfterFee)

        let tx = transactionBuilder.transaction.buildIncomplete()

        // Sign bet tx
        let sigHash = tx.hashForWitnessV0(0, contractScript, winAmount, hashType)
        let clientSig = clientKey.sign(sigHash).toScriptSignature(hashType)

        let scriptSig = []

        // client signature
        scriptSig.push(clientSig.length)
        clientSig.forEach((item) => { scriptSig.push(item) })

        // host secret
        scriptSig.push(hostSecret.length)
        hostSecret.forEach((item) => { scriptSig.push(item) })

        // client secret
        scriptSig.push(clientSecret.length)
        clientSecret.forEach((item) => { scriptSig.push(item) })

        // client wins mode
        scriptSig.push(0x00)

        if (contractScript.length > 75) scriptSig.push(0x4c)
        scriptSig.push(contractScript.length)
        contractScript.forEach((item) => { scriptSig.push(item) })
        
        scriptSig = Buffer(scriptSig)
        tx.setInputScript(0, scriptSig)
        
        let hex = tx.toHex()

        try {
            await network.sendRawAsync(hex)
            rtn.won = true
        }
        catch(ex) { }

        return rtn
    }

    static async claimWinHostTimeout(wallet, betScript, betTxId, betAmount) {
        // TODO:
        // let hostKey = BITBOX.ECPair.fromWIF(wallet.wif)
        // let transactionBuilder = new BITBOX.TransactionBuilder('bitcoincash')

        // let hashType = 0xc1
        // let byteCount = BITBOX.BitcoinCash.getByteCount({ P2PKH: 1 }, { P2SH: 1 })
        // let satoshisAfterFee = betAmount - byteCount - 800
        // transactionBuilder.addInput(betTxId, 0, 1)
        // transactionBuilder.addOutput(wallet.address, satoshisAfterFee)

        // let tx = transactionBuilder.transaction.buildIncomplete()

        // // Sign bet tx
        // let sigHash = tx.hashForWitnessV0(0, betScript, betAmount, hashType)
        // let hostSig = hostKey.sign(sigHash).toScriptSignature(hashType)

        // let scriptSig = []

        // // host signature
        // scriptSig.push(hostSig.length)
        // hostSig.forEach((item) => { scriptSig.push(item) })

        // // Host wins with timeout mode
        // scriptSig.push(0x00)
        // scriptSig.push(0x51)

        // if (betScript.length > 75) scriptSig.push(0x4c)
        // scriptSig.push(betScript.length)
        // betScript.forEach((item) => { scriptSig.push(item) })
        
        // scriptSig = Buffer(scriptSig)
        // tx.setInputScript(0, scriptSig)
        
        // let hex = tx.toHex();
        // return await network.sendRawAsync(hex)
    }

    static encodeHostEscrow(hostPubKey, hostCommitment, clientPubKey) {
        let script = [
            BITBOX.Script.opcodes.OP_IF,
            BITBOX.Script.opcodes.OP_HASH160,
            hostCommitment.length
        ];

        hostCommitment.forEach(i => script.push(i));

        script = script.concat([
            BITBOX.Script.opcodes.OP_EQUALVERIFY,
            BITBOX.Script.opcodes.OP_2,
            hostPubKey.length
        ]);

        hostPubKey.forEach(i => script.push(i));
        script.push(clientPubKey.length);
        clientPubKey.forEach(i => script.push(i));

        script = script.concat([
            BITBOX.Script.opcodes.OP_2,
            BITBOX.Script.opcodes.OP_CHECKMULTISIG,
            BITBOX.Script.opcodes.OP_ELSE,
            0x51,
            BITBOX.Script.opcodes.OP_CHECKSEQUENCEVERIFY,
            BITBOX.Script.opcodes.OP_DROP,
            hostPubKey.length
        ]);

        hostPubKey.forEach(i => script.push(i));
        script = script.concat([
            BITBOX.Script.opcodes.OP_CHECKSIG,
            BITBOX.Script.opcodes.OP_ENDIF
        ]);

        return BITBOX.Script.encode(script);
    }

    static encodeClientEscrow(clientPubKey, hostPubKey) {
        let script = [
            BITBOX.Script.opcodes.OP_IF,
            BITBOX.Script.opcodes.OP_2,
            hostPubKey.length
        ]

        hostPubKey.forEach(i => script.push(i));
        script.push(clientPubKey.length);
        clientPubKey.forEach(i => script.push(i));

        script = script.concat([
            BITBOX.Script.opcodes.OP_2,
            BITBOX.Script.opcodes.OP_CHECKMULTISIG,
            BITBOX.Script.opcodes.OP_ELSE,
            0x51,
            BITBOX.Script.opcodes.OP_CHECKSEQUENCEVERIFY,
            BITBOX.Script.opcodes.OP_DROP,
            hostPubKey.length
        ]);

        hostPubKey.forEach(i => script.push(i));
        script = script.concat([
            BITBOX.Script.opcodes.OP_CHECKSIG,
            BITBOX.Script.opcodes.OP_ENDIF
        ]);

        return BITBOX.Script.encode(script);
    }

    static encodeBetContract(hostPubKey, clientPubKey, hostCommitment, clientCommitment) {
        let script = [
            BITBOX.Script.opcodes.OP_IF,
            BITBOX.Script.opcodes.OP_IF,
            BITBOX.Script.opcodes.OP_HASH160,
            clientCommitment.length
        ];

        clientCommitment.forEach(i => script.push(i));

        script = script.concat([
            BITBOX.Script.opcodes.OP_EQUALVERIFY,
            BITBOX.Script.opcodes.OP_ELSE,
            0x51,
            BITBOX.Script.opcodes.OP_CHECKSEQUENCEVERIFY,
            BITBOX.Script.opcodes.OP_DROP,
            BITBOX.Script.opcodes.OP_ENDIF,
            hostPubKey.length
        ]);

        hostPubKey.forEach(i => script.push(i));

        script = script.concat([
            BITBOX.Script.opcodes.OP_CHECKSIG,
            BITBOX.Script.opcodes.OP_ELSE,
            BITBOX.Script.opcodes.OP_DUP,
            BITBOX.Script.opcodes.OP_HASH160,
            clientCommitment.length
        ]);
        clientCommitment.forEach(i => script.push(i));

        script = script.concat([
            BITBOX.Script.opcodes.OP_EQUALVERIFY,
            BITBOX.Script.opcodes.OP_OVER,
            BITBOX.Script.opcodes.OP_HASH160,
            hostCommitment.length
        ]);
        hostCommitment.forEach(i => script.push(i));

        script = script.concat([
            BITBOX.Script.opcodes.OP_EQUALVERIFY,
            BITBOX.Script.opcodes.OP_4,
            BITBOX.Script.opcodes.OP_SPLIT,
            BITBOX.Script.opcodes.OP_DROP,
            BITBOX.Script.opcodes.OP_BIN2NUM,
            BITBOX.Script.opcodes.OP_SWAP,
            BITBOX.Script.opcodes.OP_4,
            BITBOX.Script.opcodes.OP_SPLIT,
            BITBOX.Script.opcodes.OP_DROP,
            BITBOX.Script.opcodes.OP_BIN2NUM,
            BITBOX.Script.opcodes.OP_ADD,
            BITBOX.Script.opcodes.OP_2,
            BITBOX.Script.opcodes.OP_MOD,
            BITBOX.Script.opcodes.OP_0,
            BITBOX.Script.opcodes.OP_EQUALVERIFY,
            clientPubKey.length
        ]);
        clientPubKey.forEach(i => script.push(i));

        script = script.concat([
            BITBOX.Script.opcodes.OP_CHECKSIG,
            BITBOX.Script.opcodes.OP_ENDIF,
        ]);

        return BITBOX.Script.encode(script);
    }

    static encodeClientSignatures(wallet, hostEscrowScript, clientEscrowScript, betContractScript, hostTxId, clientTxId, amount) {
      let clientKey = BITBOX.ECPair.fromWIF(wallet.wif)
      let transactionBuilder = new BITBOX.TransactionBuilder('bitcoincash')

      let hashType = 0xc1
      let byteCount = BITBOX.BitcoinCash.getByteCount({ P2PKH: 1 }, { P2SH: 1 })
      let satoshisAfterFee = (amount*2) - byteCount - 750 // TODO: Improve fee calculation
      transactionBuilder.addInput(hostTxId, 0)
      transactionBuilder.addInput(clientTxId, 0)

      // Determine bet address
      let p2sh_hash160 = BITBOX.Crypto.hash160(betContractScript)
      let scriptPubKey = BITBOX.Script.scriptHash.output.encode(p2sh_hash160)
      let betAddress = BITBOX.Address.fromOutputScript(scriptPubKey)
      transactionBuilder.addOutput(betAddress, satoshisAfterFee)

      let tx = transactionBuilder.transaction.buildIncomplete()

      // Sign Host escrow
      let sigHash1 = tx.hashForWitnessV0(0, hostEscrowScript, amount, hashType)
      let clientSig1 = clientKey.sign(sigHash1).toScriptSignature(hashType)

      // Sign bob's escrow
      let sigHash2 = tx.hashForWitnessV0(1, clientEscrowScript, amount, hashType)
      let clientSig2 = clientKey.sign(sigHash2).toScriptSignature(hashType)

      return [clientSig1, clientSig2]
    }

    static async _fundEscrow(wallet, amount, script) {
        let utxo = await network.getUtxo(wallet.address)
        let transactionBuilder = new BITBOX.TransactionBuilder('bitcoincash')
        let hashType = transactionBuilder.hashTypes.SIGHASH_ALL | transactionBuilder.hashTypes.SIGHASH_ANYONECANPAY

        transactionBuilder.addInput(utxo.txid, utxo.vout)

        let byteCount = BITBOX.BitcoinCash.getByteCount({ P2PKH: 1 }, { P2SH: 1 }) + 50
        let satoshisAfterFee = utxo.satoshis - byteCount - amount

        let p2sh_hash160 = BITBOX.Crypto.hash160(script)
        let scriptPubKey = BITBOX.Script.scriptHash.output.encode(p2sh_hash160)
        let address = BITBOX.Address.fromOutputScript(scriptPubKey)

        transactionBuilder.addOutput(address, amount)
        transactionBuilder.addOutput(utxo.legacyAddress, satoshisAfterFee)

        let key = BITBOX.ECPair.fromWIF(wallet.wif)

        let redeemScript
        transactionBuilder.sign(0, key, redeemScript, hashType, utxo.satoshis)

        let hex = transactionBuilder.build().toHex()
        return await network.sendRawAsync(hex)
    }


}

export default ChainbetContract
