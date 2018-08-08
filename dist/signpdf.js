'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.signpdf = exports.DEFAULT_SIGNATURE_MAX_LENGTH = exports.DEFAULT_BYTE_RANGE_PLACEHOLDER = undefined;

var _nodeForge = require('node-forge');

var _nodeForge2 = _interopRequireDefault(_nodeForge);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

const PKCS12_CERT_BAG = '1.2.840.113549.1.12.10.1.3';
const PKCS12_KEY_BAG = '1.2.840.113549.1.12.10.1.2';
const DEFAULT_BYTE_RANGE_PLACEHOLDER = exports.DEFAULT_BYTE_RANGE_PLACEHOLDER = '**********';
const DEFAULT_SIGNATURE_MAX_LENGTH = exports.DEFAULT_SIGNATURE_MAX_LENGTH = 8192;

function pad2(num) {
    const s = `0${num}`;
    return s.substr(s.length - 2);
}

function strHex(s) {
    let a = '';
    for (let i = 0; i < s.length; i += 1) {
        a += pad2(s.charCodeAt(i).toString(16));
    }
    return a;
}

class signpdf {

    constructor() {
        this.byteRangePlaceholder = DEFAULT_BYTE_RANGE_PLACEHOLDER;
        this.signatureMaxLength = DEFAULT_SIGNATURE_MAX_LENGTH;
    }

    sign(pdfBuffer, p12Buffer) {
        if (!(pdfBuffer instanceof Buffer)) {
            throw new Error('PDF expected as Buffer.');
        }
        if (!(p12Buffer instanceof Buffer)) {
            throw new Error('p12 certificate expected as Buffer.');
        }

        let pdf = pdfBuffer;
        const lastChar = pdfBuffer.slice(pdfBuffer.length - 1).toString();
        if (lastChar === '\n') {
            // remove the trailing new line
            pdf = pdf.slice(0, pdf.length - 1);
        }

        const byteRangePlaceholder = [0, `/${this.byteRangePlaceholder}`, `/${this.byteRangePlaceholder}`, `/${this.byteRangePlaceholder}`];
        const byteRangeString = `/ByteRange [${byteRangePlaceholder.join(' ')}]`;
        const byteRangePos = pdf.indexOf(byteRangeString);
        if (byteRangePos === -1) {
            throw new Error(`Could not find ByteRange placeholder: ${byteRangeString}`);
        }
        const byteRangeEnd = byteRangePos + byteRangeString.length;
        const byteRange = [0, 0, 0, 0];
        byteRange[1] = byteRangeEnd + '\n/Contents '.length;
        byteRange[2] = byteRange[1] + this.signatureMaxLength * 2 + '<>'.length;
        byteRange[3] = pdf.length - byteRange[2];
        let actualByteRange = `/ByteRange [${byteRange.join(' ')}]`;
        actualByteRange += ' '.repeat(byteRangeString.length - actualByteRange.length);

        // Replace the /ByteRange placeholder with the actual ByteRange
        pdf = Buffer.concat([pdf.slice(0, byteRangePos), Buffer.from(actualByteRange), pdf.slice(byteRangeEnd)]);

        // Remove the placeholder signature
        pdf = Buffer.concat([pdf.slice(0, byteRange[1]), pdf.slice(byteRange[2], byteRange[2] + byteRange[3])]);

        const forgeCert = _nodeForge2.default.util.createBuffer(p12Buffer.toString('binary'));
        const p12Asn1 = _nodeForge2.default.asn1.fromDer(forgeCert);
        const p12 = _nodeForge2.default.pkcs12.pkcs12FromAsn1(p12Asn1, false, '');
        // get bags by type
        const certBags = p12.getBags({ bagType: PKCS12_CERT_BAG })[PKCS12_CERT_BAG];
        const keyBags = p12.getBags({ bagType: PKCS12_KEY_BAG })[PKCS12_KEY_BAG];

        const p7 = _nodeForge2.default.pkcs7.createSignedData();
        p7.content = _nodeForge2.default.util.createBuffer(pdf.toString('binary'));
        let last = certBags[0];
        Object.keys(certBags).forEach(i => {
            p7.addCertificate(certBags[i].cert);
            last = certBags[i];
        });

        p7.addSigner({
            key: keyBags[0].key,
            certificate: last.cert,
            digestAlgorithm: _nodeForge2.default.pki.oids.sha256,
            authenticatedAttributes: [{
                type: _nodeForge2.default.pki.oids.contentType,
                value: _nodeForge2.default.pki.oids.data
            }, {
                type: _nodeForge2.default.pki.oids.messageDigest
                // value will be auto-populated at signing time
            }, {
                type: _nodeForge2.default.pki.oids.signingTime,
                // value can also be auto-populated at signing time
                value: new Date()
            }]
        });
        p7.sign();

        const raw = _nodeForge2.default.asn1.toDer(p7.toAsn1()).getBytes();

        let signature = strHex(raw);
        signature += Buffer.from(String.fromCharCode(0).repeat(this.signatureMaxLength - raw.length)).toString('hex');

        pdf = Buffer.concat([pdf.slice(0, byteRange[1]), Buffer.from(`<${signature}>`), pdf.slice(byteRange[1])]);

        return pdf;
    }
}

exports.signpdf = signpdf;
exports.default = new signpdf();