"""Minimal JSON Schema validator for the subset used by tiles.schema.json (T-2.3).

jsonschema is not a project dependency, so this covers exactly the keywords the schema uses:
type, const, properties, required, additionalProperties (false or a schema), items, minItems,
maxItems, minimum, exclusiveMinimum, minLength, pattern and local ``$ref`` ("#/$defs/...").
An unknown keyword raises, so the schema cannot silently outgrow the validator.
"""

import re

_ANNOTATIONS = {"$schema", "title", "$defs"}
_TYPES = {
    "object": lambda v: isinstance(v, dict),
    "array": lambda v: isinstance(v, list),
    "string": lambda v: isinstance(v, str),
    "integer": lambda v: isinstance(v, int) and not isinstance(v, bool),
    "number": lambda v: isinstance(v, int | float) and not isinstance(v, bool),
}


def _resolve(root: dict, ref: str) -> dict:
    if not ref.startswith("#/"):
        raise ValueError(f"unsupported $ref {ref}")
    node = root
    for part in ref[2:].split("/"):
        node = node[part]
    return node


def validate(instance, schema: dict, root: dict | None = None, path: str = "$") -> list[str]:
    """Return a list of error messages (empty when the instance is valid)."""
    root = root or schema
    if "$ref" in schema:
        return validate(instance, _resolve(root, schema["$ref"]), root, path)
    errors: list[str] = []
    for key, rule in schema.items():
        if key in _ANNOTATIONS:
            continue
        if key == "type":
            if not _TYPES[rule](instance):
                return [f"{path}: expected {rule}, got {type(instance).__name__}"]
        elif key == "const":
            same = instance == rule and type(instance) is type(rule)
            if not same and not (
                _TYPES["number"](instance) and _TYPES["number"](rule) and instance == rule
            ):
                errors.append(f"{path}: expected {rule!r}, got {instance!r}")
        elif key == "required":
            errors += [f"{path}: missing '{k}'" for k in rule if k not in instance]
        elif key == "properties":
            for k, sub in rule.items():
                if k in instance:
                    errors += validate(instance[k], sub, root, f"{path}.{k}")
        elif key == "additionalProperties":
            extra = sorted(set(instance) - set(schema.get("properties", {})))
            for k in extra:
                if rule is False:
                    errors.append(f"{path}: unexpected '{k}'")
                else:
                    errors += validate(instance[k], rule, root, f"{path}.{k}")
        elif key == "items":
            for n, v in enumerate(instance):
                errors += validate(v, rule, root, f"{path}[{n}]")
        elif key == "minItems":
            if len(instance) < rule:
                errors.append(f"{path}: fewer than {rule} items")
        elif key == "maxItems":
            if len(instance) > rule:
                errors.append(f"{path}: more than {rule} items")
        elif key == "minimum":
            if instance < rule:
                errors.append(f"{path}: {instance} < {rule}")
        elif key == "exclusiveMinimum":
            if instance <= rule:
                errors.append(f"{path}: {instance} <= {rule}")
        elif key == "minLength":
            if len(instance) < rule:
                errors.append(f"{path}: shorter than {rule}")
        elif key == "pattern":
            if not re.search(rule, instance):
                errors.append(f"{path}: {instance!r} does not match {rule!r}")
        else:
            raise ValueError(f"unsupported schema keyword {key!r} at {path}")
    return errors
