import {diagnostic} from "../code/diagnostic";
import {getNodeLocation, NodeConstructCall, NodeFuncCall, NodeName} from "./nodes";
import {DeducedType, resolveTemplateType, SymbolicFunction, SymbolScope, TemplateTranslation} from "./symbolic";
import {isTypeMatch} from "./checkType";
import {ParsingToken} from "./parsingToken";

export interface FunctionMatchingArgs {
    scope: SymbolScope;
    callerNode: NodeFuncCall | NodeConstructCall;
    callerArgs: (DeducedType | undefined)[];
    calleeFunc: SymbolicFunction;
    templateTranslator: TemplateTranslation | undefined;
}

export function checkFunctionMatch(
    args: FunctionMatchingArgs
): DeducedType | undefined {
    const {scope, callerNode, callerArgs, calleeFunc, templateTranslator} = args;
    const calleeParams = calleeFunc.sourceNode.paramList;

    if (callerArgs.length > calleeParams.length) {
        // 呼び出し側の引数の数が多すぎる場合へ対処
        return handleTooMuchCallerArgs(args);
    }

    for (let i = 0; i < calleeParams.length; i++) {
        if (i >= callerArgs.length) {
            // 呼び出し側の引数が足りない場合
            const param = calleeParams[i];

            if (param.defaultExpr === undefined) {
                // デフォルト値も存在しない場合
                // オーバーロードが存在するなら採用
                if (calleeFunc.nextOverload !== undefined) return checkFunctionMatch({...args, calleeFunc: calleeFunc.nextOverload});
                diagnostic.addError(getNodeLocation(callerNode.nodeRange), `Missing argument for parameter '${param.identifier?.text}' 💢`);
                break;
            }
        }

        let actualType = callerArgs[i];
        let expectedType = calleeFunc.parameterTypes[i];
        if (templateTranslator !== undefined) {
            actualType = resolveTemplateType(templateTranslator, actualType);
            expectedType = resolveTemplateType(templateTranslator, expectedType);
        }

        if (actualType === undefined || expectedType === undefined) continue;
        if (isTypeMatch(actualType, expectedType)) continue;

        // オーバーロードが存在するなら使用
        if (calleeFunc.nextOverload !== undefined) return checkFunctionMatch({...args, calleeFunc: calleeFunc.nextOverload});
        diagnostic.addError(getNodeLocation(callerNode.argList.argList[i].assign.nodeRange),
            `Cannot convert '${actualType.symbol.declaredPlace.text}' to parameter type '${expectedType.symbol.declaredPlace.text}' 💢`);
    }

    pushReferenceOfFuncOrConstructor(callerNode, scope, calleeFunc);
    return calleeFunc.returnType;
}

function handleTooMuchCallerArgs(args: FunctionMatchingArgs) {
    const {scope, callerNode, callerArgs, calleeFunc, templateTranslator} = args;

    // オーバーロードが存在するなら採用
    if (calleeFunc.nextOverload !== undefined) return checkFunctionMatch({...args, calleeFunc: calleeFunc.nextOverload});

    diagnostic.addError(getNodeLocation(callerNode.nodeRange),
        `Function has ${calleeFunc.sourceNode.paramList.length} parameters, but ${callerArgs.length} were provided 💢`);
    pushReferenceOfFuncOrConstructor(callerNode, scope, calleeFunc);
    return calleeFunc.returnType;
}

function pushReferenceOfFuncOrConstructor(callerNode: NodeFuncCall | NodeConstructCall, scope: SymbolScope, calleeFunc: SymbolicFunction) {
    const callerIdentifier = getIdentifierInFuncOrConstructor(callerNode);
    scope.referencedList.push({declaredSymbol: calleeFunc, referencedToken: callerIdentifier});
}

function getIdentifierInFuncOrConstructor(funcCall: NodeFuncCall | NodeConstructCall): ParsingToken {
    if (funcCall.nodeName === NodeName.FuncCall) {
        return funcCall.identifier;
    } else {
        return funcCall.type.dataType.identifier;
    }
}