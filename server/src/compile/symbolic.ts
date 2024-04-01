import {LocationInfo, TokenKind} from "./tokens";
import {NodeClass, NodeEnum, NodeFunc, NodeIf, NodeName} from "./nodes";
import {createVirtualToken, ParsingToken} from "./parsingToken";
import {diagnostic} from "../code/diagnostic";
import {numberTypeSet} from "./tokenReserves";
import assert = require("assert");

export enum SymbolKind {
    Type = 'Type',
    Function = 'Function',
    Variable = 'Variable',
}

export enum PrimitiveType {
    Template = 'Template',
    String = 'String',
    Bool = 'Bool',
    Number = 'Number',
    Void = 'Void',
    Any = 'Any',
    Auto = 'Auto',
}

export type SourceType = NodeEnum | NodeClass | PrimitiveType;

export function isSourcePrimitiveType(type: SourceType): type is PrimitiveType {
    return typeof type === 'string';
}

export function isSourceNodeClass(type: SourceType): type is NodeClass {
    if (isSourcePrimitiveType(type)) return false;
    return type.nodeName === NodeName.Class;
}

export interface SymbolicBase {
    symbolKind: SymbolKind;
    declaredPlace: ParsingToken;
}

export interface SymbolicType extends SymbolicBase {
    symbolKind: SymbolKind.Type;
    sourceType: SourceType;
    templateTypes?: ParsingToken[];
}

export interface SymbolicFunction extends SymbolicBase {
    symbolKind: SymbolKind.Function;
    sourceNode: NodeFunc;
    returnType: DeducedType | undefined;
    parameterTypes: (DeducedType | undefined)[];
    nextOverload: SymbolicFunction | undefined;
}

export interface SymbolicVariable extends SymbolicBase {
    symbolKind: SymbolKind.Variable;
    type: DeducedType | undefined;
}

export type SymbolicObject = SymbolicType | SymbolicFunction | SymbolicVariable;

// (IF | FOR | WHILE | RETURN | STATBLOCK | BREAK | CONTINUE | DOWHILE | SWITCH | EXPRSTAT | TRY)
export type SymbolOwnerNode = NodeEnum | NodeClass | NodeFunc | NodeIf;

export interface ReferencedSymbolInfo {
    declaredSymbol: SymbolicBase;
    referencedToken: ParsingToken;
}

export type ScopeMap = Map<string, SymbolScope>;

export type SymbolMap = Map<string, SymbolicObject>;

// 親ノードと親スコープ
export interface ScopeBirthInfo {
    ownerNode: SymbolOwnerNode | undefined;
    parentScope: SymbolScope | undefined;
}

// 定義されたシンボル情報と小スコープ
export interface ScopeContainInfo {
    childScopes: ScopeMap;
    symbolMap: SymbolMap;
}

// 参照情報や補完情報
export interface ScopeServiceInfo {
    referencedList: ReferencedSymbolInfo[];
    completionHints: ComplementHints[];
}

export interface SymbolScope extends ScopeBirthInfo, ScopeContainInfo, ScopeServiceInfo {
}

export interface SymbolAndScope {
    symbol: SymbolicObject;
    scope: SymbolScope;
}

export function insertSymbolicObject(map: SymbolMap, symbol: SymbolicObject): boolean {
    const identifier = symbol.declaredPlace.text;
    const hit = map.get(identifier);
    if (hit === undefined) {
        map.set(identifier, symbol);
        return true;
    }
    const canOverload = symbol.symbolKind === SymbolKind.Function && hit.symbolKind === SymbolKind.Function;
    if (canOverload === false) {
        diagnostic.addError(symbol.declaredPlace.location, `Symbol '${identifier}' is already defined 💢`);
        return false;
    }

    // 関数はオーバーロードとして追加が可能
    let cursor = hit;
    for (; ;) {
        if (cursor.nextOverload === undefined) {
            cursor.nextOverload = symbol;
            return true;
        }
        cursor = cursor.nextOverload;
    }
}

export type TemplateTranslation = Map<ParsingToken, DeducedType | undefined>;

export function resolveTemplateType(
    templateTranslate: TemplateTranslation, arg: DeducedType | undefined
): DeducedType | undefined {
    if (arg !== undefined && templateTranslate.has(arg.symbol.declaredPlace)) {
        return templateTranslate.get(arg.symbol.declaredPlace);
    }
    return arg;
}

export function resolveTemplateTypes(templateTranslate: TemplateTranslation, args: (DeducedType | undefined)[]) {
    return args.map(arg => resolveTemplateType(templateTranslate, arg));
}

export interface DeducedType {
    symbol: SymbolicType;
    sourceScope: SymbolScope | undefined;
    templateTranslate?: TemplateTranslation;
}

export function stringifyDeducedType(type: DeducedType | undefined): string {
    if (type === undefined) return '(undefined)';

    let template = '';
    if (type.templateTranslate !== undefined) {
        template = `<${Array.from(type.templateTranslate.values()).map(t => stringifyDeducedType(t)).join(', ')}>`;
    }

    return type.symbol.declaredPlace.text + template;
}

export function stringifyDeducedTypes(types: (DeducedType | undefined)[]): string {
    return types.map(t => stringifyDeducedType(t)).join(', ');
}

export enum ComplementKind {
    Scope = 'Scope',
    Type = 'Type',
    Namespace = 'Namespace',
}

export interface ComplementBase {
    complementKind: ComplementKind;
    complementLocation: LocationInfo;
}

export interface ComplementScope extends ComplementBase {
    complementKind: ComplementKind.Scope;
    targetScope: SymbolScope;
}

export interface ComplementType extends ComplementBase {
    complementKind: ComplementKind.Type;
    targetType: SymbolicType;
}

export interface CompletionNamespace extends ComplementBase {
    complementKind: ComplementKind.Namespace;
    namespaceList: ParsingToken[];
}

export type ComplementHints = ComplementScope | ComplementType | CompletionNamespace;

function createBuiltinType(virtualToken: ParsingToken, name: PrimitiveType): SymbolicType {
    return {
        symbolKind: SymbolKind.Type,
        declaredPlace: virtualToken,
        sourceType: name,
    } as const;
}

const builtinNumberTypeMap: Map<string, SymbolicType> = (() => {
    const map = new Map<string, SymbolicType>();
    for (const name of numberTypeSet) {
        map.set(name, createBuiltinType(createVirtualToken(TokenKind.Reserved, name), PrimitiveType.Number));
    }
    return map;
})();

export const builtinStringType: SymbolicType = createBuiltinType(createVirtualToken(TokenKind.String, 'string'), PrimitiveType.String);

export const builtinIntType = builtinNumberTypeMap.get('int')!;

export const builtinFloatType = builtinNumberTypeMap.get('float')!;

export const builtinDoubleType = builtinNumberTypeMap.get('double')!;

function assignBuiltinNumberType(key: string): SymbolicType {
    const type = builtinNumberTypeMap.get(key);
    if (type !== undefined) return type;
    assert(false);
}

export const builtinBoolType: SymbolicType = createBuiltinType(createVirtualToken(TokenKind.Reserved, 'bool'), PrimitiveType.Bool);

export const builtinVoidType: SymbolicType = createBuiltinType(createVirtualToken(TokenKind.Reserved, 'void'), PrimitiveType.Void);

export const builtinAnyType: SymbolicType = createBuiltinType(createVirtualToken(TokenKind.Reserved, '?'), PrimitiveType.Any);

export const builtinAutoType: SymbolicType = createBuiltinType(createVirtualToken(TokenKind.Reserved, 'auto'), PrimitiveType.Auto);

export function tryGetBuiltInType(token: ParsingToken): SymbolicType | undefined {
    if (token.kind !== TokenKind.Reserved) return undefined;

    const identifier = token.text;
    if ((identifier === 'bool')) return builtinBoolType;
    else if ((identifier === 'void')) return builtinVoidType;
    else if (identifier === '?') return builtinAnyType;
    else if (identifier === 'auto') return builtinAutoType;
    else if (token.kind === TokenKind.Reserved && token.property.isNumber) return assignBuiltinNumberType(identifier);

    return undefined;
}

export function findSymbolShallowly(scope: SymbolScope, identifier: string): SymbolicObject | undefined {
    return scope.symbolMap.get(identifier);
}

export function findSymbolWithParent(scope: SymbolScope, identifier: string): SymbolAndScope | undefined {
    const symbol = scope.symbolMap.get(identifier);
    if (symbol !== undefined) return {symbol: symbol, scope: scope};
    if (scope.parentScope === undefined) return undefined;
    return findSymbolWithParent(scope.parentScope, identifier);
}
