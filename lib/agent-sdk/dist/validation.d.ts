export declare const VALIDATION_LIMITS: {
    readonly NAME_MAX_BYTES: 100;
    readonly DESCRIPTION_MAX_BYTES: 500;
    readonly BUILDER_CODE_MAX_BYTES: 100;
    readonly TAG_MAX_BYTES: 64;
    readonly ENDPOINT_MAX_BYTES: 256;
    readonly FEEDBACK_URI_MAX_BYTES: 512;
    readonly VALUE_DECIMALS_MIN: 0;
    readonly VALUE_DECIMALS_MAX: 18;
};
export declare function validateStringField(value: string | undefined, fieldName: string, maxBytes: number, required?: boolean): void;
export declare function assertPublicUrl(raw: string, label?: string): void;
