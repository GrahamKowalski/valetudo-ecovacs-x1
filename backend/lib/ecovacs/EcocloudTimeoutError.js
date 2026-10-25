// Derived from ValetudoEV (https://github.com/itsjfx/ValetudoEV, Copyright itsjfx), a fork of
// Valetudo (https://github.com/Hypfer/Valetudo, Copyright Sören Beye). Licensed Apache-2.0.
// Imported unmodified from ValetudoEV commit d7a48bca; later changes are recorded in git history.

class EcocloudTimeoutError extends Error {
    /**
     * @param {string} cmd The command that was not responded to.
     * @param {object} msg The request data that was not responded to.
     */
    constructor(cmd, msg) {
        super(`request: ${cmd} timed out: ${JSON.stringify(msg)}`);
        this.name = "EcocloudTimeoutError";
    }
}

module.exports = EcocloudTimeoutError;
