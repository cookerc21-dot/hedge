export class CustomUrlStorage {
    uri;
    constructor(uri) {
        this.uri = uri;
    }
    async uploadJSON(_data, _name) {
        return this.uri;
    }
}
//# sourceMappingURL=custom-url.js.map