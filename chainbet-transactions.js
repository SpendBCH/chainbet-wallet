let BITBOXCli = require('bitbox-cli/lib/bitbox-cli').default;
let BITBOX = new BITBOXCli();
let chainbet = require('chainbet')

module.exports = class ChainbetTransactions {
    static async getUtxo(address) {
        return new Promise( (resolve, reject) => {
            BITBOX.Address.utxo(address).then((result) => { 
                resolve(result[0])
            }, (err) => { 
                console.log(err)
                reject(err)
            })
        })
    }

    static async sendRawAsync(hex) {
        return new Promise( (resolve, reject) => {
            BITBOX.RawTransactions.sendRawTransaction(hex).then((result) => { 
                if (result.length < 60) { // TODO: Validate result is a txid
                    console.log('txid:', result)
                    reject("txid too small")
                }
                else {
                    console.log("txid: ", result)
                    resolve(result)
                }
            }, (err) => { 
                console.log(err)
                reject(err)
            })
        })
    }

    static async sendMessagePhase1(wallet, type, amount, targetAddress) {
        let script = chainbet.encodePhase1(type, amount, targetAddress)
        return await this.sendMessage(wallet, script)
    }

    static async sendMessagePhase2(wallet, betTxId, hostPubKey, hostCommitment) {
        let script = chainbet.encodePhase2(betTxId, hostPubKey, hostCommitment)
        return await this.sendMessage(wallet, script)
    }

    static async sendMessagePhase3(wallet, betTxId, participantTxId, hostEscrowTxId, hostPubKey) {
        let script = chainbet.encodePhase3(betTxId, participantTxId, hostEscrowTxId, hostPubKey)
        return await this.sendMessage(wallet, script)
    }

    static async sendMessagePhase4(wallet, multisigPubKeys, participantEscrowTxid, hostCommitment, hostEscrowTxId, betTxId) {
        let hostEscrowScript = this.encodeHostEscrow(multisigPubKeys[0], hostCommitment, multisigPubKeys[1])
        let participantEscrowScript = this.encodeParticipantEscrow(multisigPubKeys[1], multisigPubKeys[0])
        let participantSig1 = this.buildParticipantSignature(wallet, multisigPubKeys, participantEscrowScript, participantEscrowTxid)
        let participantSig2 = this.buildParticipantSignature(wallet, multisigPubKeys, hostEscrowScript, hostEscrowTxId)

        let script = chainbet.encodePhase4(betTxId, participantEscrowTxid, participantSig1, participantSig2)
        return await this.sendMessage(wallet, script)
    }

    static async sendMessagePhase6(betTxId, secret) {
        let script = chainbet.encodephase6(betTxId, secret)
        return await this.sendMessage(wallet, script)
    }

    static async sendMessage(wallet, script) {
        return new Promise( async (resolve, reject) => {
            let utxo = await this.getUtxo(wallet.address)
            let transactionBuilder = new BITBOX.TransactionBuilder('bitcoincash')
    
            transactionBuilder.addInput(utxo.txid, utxo.vout)
    
            let byteCount = BITBOX.BitcoinCash.getByteCount({ P2PKH: 1 }, { P2SH: 1 }) + Buffer.byteLength(script) + 20
            let satoshisAfterFee = utxo.satoshis - byteCount
    
            transactionBuilder.addOutput(utxo.cashAddress, satoshisAfterFee)
            transactionBuilder.addOutput(script, 0)
    
            let key = BITBOX.ECPair.fromWIF(wallet.wif)
    
            let redeemScript
            transactionBuilder.sign(0, key, redeemScript, transactionBuilder.hashTypes.SIGHASH_ALL, utxo.satoshis)
    
            let hex = transactionBuilder.build().toHex()
            resolve(await this.sendRawAsync(hex))
        })
    }

    static encodeHostEscrow(hostPubKey, hostCommitment, participantPubKey) {
        let asm = `OP_IF 08 OP_CHECKSEQUENCEVERIFY ${hostPubKey} OP_ELSE OP_HASH160 ${hostCommitment.toString('hex')}`
            + ` OP_EQUALVERIFY OP_2 ${hostPubKey} ${participantPubKey} OP_2 OP_CHECKMULTISIG OP_ENDIF`
    
        return BITBOX.Script.fromASM(asm)
    }

    static encodeParticipantEscrow(participantPubKey, hostPubKey) {
        let asm = `OP_IF 08 OP_CHECKSEQUENCEVERIFY ${participantPubKey} OP_ELSE OP_2`
            + ` ${hostPubKey} ${participantPubKey} OP_2 OP_CHECKMULTISIG OP_ENDIF`
    
        return BITBOX.Script.fromASM(asm)
    }

    static async fundHostEscrow(wallet, multisigPubKeys, amount, hostCommitment) {
        let script = this.encodeHostEscrow(multisigPubKeys[0], hostCommitment, multisigPubKeys[1])
        return await this.fundEscrow(wallet, multisigPubKeys, amount, script)
    }

    static async fundParticipantEscrow(wallet, multisigPubKeys, amount) {
        let script = this.encodeParticipantEscrow(multisigPubKeys[1], multisigPubKeys[0])
        return await this.fundEscrow(wallet, multisigPubKeys, amount, script)
    }

    static async fundEscrow(wallet, multisigPubKeys, amount, script) {
        return new Promise( async (resolve, reject) => {
            let utxo = await this.getUtxo(wallet.address)
            let transactionBuilder = new BITBOX.TransactionBuilder('bitcoincash')
            let hashType = transactionBuilder.hashTypes.SIGHASH_ALL | transactionBuilder.hashTypes.SIGHASH_ANYONECANPAY
    
            transactionBuilder.addInput(utxo.txid, utxo.vout)
    
            let byteCount = BITBOX.BitcoinCash.getByteCount({ P2PKH: 1 }, { P2SH: 1 }) + Buffer.byteLength(script) + 20
            let satoshisAfterFee = utxo.satoshis - byteCount - amount
    
            let pubkeys = multisigPubKeys.map(function (hex) { return Buffer.from(hex, 'hex') })
            var rs = BITBOX.Script.multisig.output.encode(1, pubkeys)
            var scriptPubKey = BITBOX.Script.scriptHash.output.encode(BITBOX.Crypto.hash160(rs))
            var address = BITBOX.Address.fromOutputScript(scriptPubKey)
    
            transactionBuilder.addOutput(address, amount)
            transactionBuilder.addOutput(utxo.cashAddress, satoshisAfterFee)
    
            let key = BITBOX.ECPair.fromWIF(wallet.wif)
    
            let redeemScript
            transactionBuilder.sign(0, key, redeemScript, hashType, utxo.satoshis)
    
            let hex = transactionBuilder.build().toHex()
            resolve(await this.sendRawAsync(hex))
        })
    }

    static async buildParticipantSignature(wallet, script, txid) {
        return new Promise( async (resolve, reject) => {
            let transactionBuilder = new BITBOX.TransactionBuilder('bitcoincash')
            let hashType = transactionBuilder.hashTypes.SIGHASH_ALL
            hashType |= transactionBuilder.hashTypes.SIGHASH_ANYONECANPAY
    
            let byteCount = BITBOX.BitcoinCash.getByteCount({ P2PKH: 1 }, { P2SH: 1 }) + Buffer.byteLength(script) + 20 + 80
            let satoshisAfterFee = 2000 - byteCount
    
            transactionBuilder.addInput(txid, 1)
            transactionBuilder.addOutput(wallet.utxo.cashAddress, satoshisAfterFee)
    
            let tx = transactionBuilder.transaction.buildIncomplete()

            let redeemScriptSig = BITBOX.Script.scriptHash.input.encode([
                Buffer.from(alice.secret, 'hex')
            ], redeemScript)

            tx.setInputScript(0, redeemScriptSig)
    
            let hex = tx.toHex()
            resolve(await this.sendRawAsync(hex))
        })
    }

    static encodeBetContract(hostPubKey, participantPubKey, hostCommitment, participantCommitment) {
        // TODO
        let asm = ``    
        return BITBOX.Script.fromASM(asm)
    }

    static async fundBetContract(wallet, script, txid, amount) {
        return new Promise( (resolve, reject) => {
            // TODO
            resolve()
        })
    }

    static async claimPurse(wallet) {
        return new Promise( (resolve, reject) => {
            // TODO
            resolve()
        })
    }
}