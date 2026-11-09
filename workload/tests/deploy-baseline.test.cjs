const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const test = require('node:test');

const root = resolve(__dirname, '..', '..');
const read = (...parts) => readFileSync(join(root, ...parts), 'utf8');
const form = JSON.parse(read('workload', 'portal-ui', 'portal-ui-baseline.json'));
const template = JSON.parse(read('workload', 'arm', 'deploy-baseline.json'));
const subscriptionIdPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function* objects(value) {
  if (!value || typeof value !== 'object') return;
  if (!Array.isArray(value)) yield value;
  for (const child of Object.values(value)) yield* objects(child);
}

function control(name) {
  const result = [...objects(form)].find(value => value.name === name && value.type);
  assert.ok(result, `Missing form control ${name}`);
  return result;
}

// Evaluate the saved expressions, not a separately reimplemented deployment decision.
// This limited interpreter is an offline contract check, not the Portal runtime.
function evaluate(expression, functions) {
  if (typeof expression !== 'string' || !expression.startsWith('[') ||
      !expression.endsWith(']') || expression.startsWith('[[')) return expression;
  const body = expression.slice(1, -1);
  const tokenizer = /\s*('(?:''|[^'])*'|=>|[A-Za-z_][A-Za-z_0-9]*|-?\d+|[()[\].,])\s*/y;
  const tokens = [];
  while (tokenizer.lastIndex < body.length) {
    const position = tokenizer.lastIndex;
    const match = tokenizer.exec(body);
    assert.ok(match, `Unsupported expression token at ${position}: ${body}`);
    tokens.push(match[1]);
  }
  let position = 0;
  const take = expected => {
    const token = tokens[position++];
    if (expected !== undefined) assert.equal(token, expected);
    return token;
  };
  function parse() {
    const token = take();
    let node;
    if (token === '(') {
      const parameter = take();
      take(')');
      take('=>');
      node = { kind: 'lambda', parameter, body: parse() };
    } else if (token.startsWith("'")) {
      node = { kind: 'literal', value: token.slice(1, -1).replace(/''/g, "'") };
    } else if (/^-?\d+$/.test(token)) {
      node = { kind: 'literal', value: Number(token) };
    } else if (token === 'true' || token === 'false' || token === 'null') {
      node = { kind: 'literal', value: JSON.parse(token) };
    } else if (tokens[position] === '(') {
      take('(');
      const args = [];
      while (tokens[position] !== ')') {
        args.push(parse());
        if (tokens[position] !== ',') break;
        take(',');
      }
      take(')');
      node = { kind: 'call', name: token, args };
    } else {
      node = { kind: 'variable', name: token };
    }
    while (tokens[position] === '.' || tokens[position] === '[') {
      if (take() === '.') {
        node = { kind: 'member', object: node, key: { kind: 'literal', value: take() } };
      } else {
        node = { kind: 'member', object: node, key: parse() };
        take(']');
      }
    }
    return node;
  }
  const tree = parse();
  assert.equal(position, tokens.length, `Unparsed expression: ${body}`);
  function run(node, locals = {}) {
    if (node.kind === 'literal') return node.value;
    if (node.kind === 'variable') {
      assert.ok(Object.hasOwn(locals, node.name), `Unknown variable ${node.name}`);
      return locals[node.name];
    }
    if (node.kind === 'member') return run(node.object, locals)?.[run(node.key, locals)];
    if (node.kind === 'lambda') {
      return value => run(node.body, { ...locals, [node.parameter]: value });
    }
    if (node.name === 'if') {
      return run(node.args[0], locals) ? run(node.args[1], locals) : run(node.args[2], locals);
    }
    assert.ok(Object.hasOwn(functions, node.name), `Unsupported function ${node.name}`);
    return functions[node.name](...node.args.map(arg => run(arg, locals)));
  }
  return run(tree);
}

const functions = {
  and: (...values) => values.every(Boolean),
  or: (...values) => values.some(Boolean),
  not: value => !value,
  equals: (left, right) => left === right,
  empty: value => value == null || Object.keys(value).length === 0,
  first: value => value[0],
  map: (values, callback) => values.map(callback),
  filter: (values, callback) => values.filter(callback),
  parse: JSON.parse,
  json: JSON.parse,
  string: value => {
    assert.notEqual(value, undefined);
    return typeof value === 'string' ? value : JSON.stringify(value);
  },
  startsWith: (value, prefix) => value.startsWith(prefix),
  split: (value, delimiter) => value.split(delimiter),
  contains: (value, item) => value.includes(item),
  toLower: value => value.toLowerCase(),
  replace: (value, from, to) => value.split(from).join(to),
  concat: (...values) => values.join(''),
  decodeUriComponent: decodeURIComponent,
  int: value => {
    const result = Number(value);
    assert.ok(Number.isInteger(result), `Not an integer: ${value}`);
    return result;
  },
  length: value => value.length,
  range: (start, count) => Array.from({ length: count }, (_, index) => start + index),
  mul: (left, right) => left * right,
  div: (left, right) => Math.trunc(left / right),
  mod: (left, right) => left % right,
  createArray: (...values) => values,
  createObject: (...values) => Object.fromEntries(
    Array.from({ length: values.length / 2 }, (_, index) => [values[index * 2], values[index * 2 + 1]])
  ),
  union: (...arrays) => [...new Map(arrays.flat().map(value => [JSON.stringify(value), value])).values()],
  format: (format, ...values) => format.replace(/\{(\d+)\}/g, (_, index) => values[index]),
  resourceId: (subscription, group, type, name) =>
    `/subscriptions/${subscription}/resourceGroups/${group}/providers/${type}/${name}`
};

const uiEvaluate = (expression, state) => evaluate(expression, {
  ...functions,
  string: value => JSON.stringify(value === undefined ? null : value),
  steps: name => state[name]
});

function defaultValue(name, state) {
  const element = control(name);
  if (element.type === 'Microsoft.Common.CheckBox') {
    assert.equal(Object.hasOwn(element, 'defaultValue'), false);
    return false;
  }
  assert.ok(Object.hasOwn(element, 'defaultValue'), `No default for ${name}`);
  const value = uiEvaluate(element.defaultValue, state);
  if (!element.constraints?.allowedValues) return value;
  const allowed = uiEvaluate(element.constraints.allowedValues, state);
  const select = option => {
    const match = allowed.find(item =>
      typeof option === 'object' ? item.value === option.value : item.label === option);
    assert.ok(match, `Unavailable default for ${name}: ${JSON.stringify(option)}`);
    return match.value;
  };
  return Array.isArray(value) ? value.map(select) : select(value);
}

function state() {
  const value = {
    basics: {
      resourceScope: {
        subscription: { subscriptionId: '00000000-0000-4000-8000-000000000001' },
        location: { name: 'eastus2', displayName: 'East US 2' }
      }
    },
    managementPlane: { managementPlaneHostPoolSettings: {} },
    sessionHosts: {
      sessionHostsRegionSection: {
        computeApi: { value: [{ resourceType: 'virtualMachines', locations: ['Mexico Central', 'East US 2'] }] }
      },
      sessionHostsOsSection: {
        skusApi: [{ name: 'win11-24h2-ent' }, { name: 'win11-24h2-avd' }, { name: 'win11-23h2-ent' }]
      },
      sessionHostsSettingsSection: {},
      sessionHostsAvailabilitySection: {}
    },
    storage: {
      storageFslogix: {},
      storageAppAttach: { appAttachStorageDeployment: false },
      storageGeneralSettings: {}
    },
    network: {},
    monitoring: {}
  };
  value.managementPlane.managementPlaneHostPoolSettings.hostPoolType = defaultValue('hostPoolType', value);
  value.sessionHosts.deploySessionHosts = defaultValue('deploySessionHosts', value);
  const hosts = value.sessionHosts;
  hosts.sessionHostsRegionSection.sessionHostsRegion = defaultValue('sessionHostsRegion', value);
  hosts.sessionHostsSettingsSection.sessionHostSize = control('sessionHostSize').recommendedSizes[0];
  for (const name of ['sessionHostsCount', 'sessionHostDiskType']) {
    hosts.sessionHostsSettingsSection[name] = defaultValue(name, value);
  }
  for (const name of ['source', 'offer', 'sku']) {
    hosts.sessionHostsOsSection[name] = defaultValue(name, value);
  }
  hosts.sessionHostsAvailabilitySection.option = defaultValue('option', value);
  hosts.sessionHostsAvailabilitySection.availabilityZones = defaultValue('availabilityZones', value);
  value.storage.storageFslogix.fslogixDeployment = defaultValue('fslogixDeployment', value);
  for (const name of ['createAvdVirtualNetwork', 'virtualNetworkSize', 'virtualNetworkAvdSubnetSize',
    'virtualNetworkPrivateEndpointSubnetSize', 'deployAvdPrivateLinkService', 'virtualNetworkPrivateDnsZone']) {
    value.network[name] = defaultValue(name, value);
  }
  value.network.deployPrivateEndpointKeyvaultStorage = false;
  value.network.hostPoolPrivateEndpointNetworkAccessSelector = defaultValue('hostPoolPrivateEndpointNetworkAccessSelector', value);
  value.monitoring.deployMonitoring = defaultValue('deployMonitoring', value);
  value.monitoring.deployMonitoringAlaWorkspace = defaultValue('deployMonitoringAlaWorkspace', value);
  value.monitoring.deployMonitoringNewAlaWorkspaceRetention = defaultValue('deployMonitoringNewAlaWorkspaceRetention', value);
  return value;
}

const output = (name, value) => uiEvaluate(form.view.outputs.parameters[name], value);
const templates = [...objects(template)].filter(value => value.$schema && value.resources && value.parameters);
const hostsTemplate = templates.find(value => value.variables?.copy?.some(item => item.name === 'varZones'));
const hostsDeployment = template.resources.find(value => value.properties?.template === hostsTemplate);
const policyTemplate = templates.find(value => value.variables?.varCustomPolicySetDefinitions);
const workloadSubscriptionDependency = template.resources.flatMap(value => value.dependsOn ?? [])
  .find(value => value.startsWith("[subscriptionResourceId(parameters('avdWorkloadSubsId'),"));

function armContext(arm, parameters, deploymentSubscriptionId) {
  const cache = new Map();
  const indices = new Map();
  const resolveValue = value => {
    if (Array.isArray(value)) return value.map(resolveValue);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, resolveValue(child)]));
    }
    return evaluate(value, context);
  };
  const context = {
    ...functions,
    parameters: name => {
      if (Object.hasOwn(parameters, name)) return parameters[name];
      const definition = arm.parameters?.[name];
      assert.ok(definition && Object.hasOwn(definition, 'defaultValue'), `Missing parameter ${name}`);
      return resolveValue(definition.defaultValue);
    },
    subscription: () => {
      assert.match(deploymentSubscriptionId, subscriptionIdPattern);
      return { subscriptionId: deploymentSubscriptionId };
    },
    subscriptionResourceId: (...args) => {
      const [subscriptionId, resourceType, ...names] = /^[^/]+\.[^/]+\//.test(args[0])
        ? [context.subscription().subscriptionId, ...args]
        : args;
      assert.match(subscriptionId, subscriptionIdPattern,
        `The provided value '${subscriptionId}' is not valid subscription identifier.`);
      return `/subscriptions/${subscriptionId}/providers/${resourceType}/${names.join('/')}`;
    },
    copyIndex: (name = '') => {
      assert.ok(indices.has(name), `Missing copy index ${name}`);
      return indices.get(name);
    },
    variables: name => {
      if (!cache.has(name)) {
        const loop = arm.variables.copy?.find(item => item.name === name);
        if (loop) {
          const count = evaluate(loop.count, context);
          const values = Array.from({ length: count }, (_, index) => {
            indices.set(name, index);
            return resolveValue(loop.input);
          });
          indices.delete(name);
          cache.set(name, values);
        } else {
          assert.ok(Object.hasOwn(arm.variables, name), `Missing ARM variable ${name}`);
          cache.set(name, resolveValue(arm.variables[name]));
        }
      }
      return cache.get(name);
    }
  };
  return { evaluate: value => evaluate(value, context), variables: context.variables, indices };
}

test('Multiva form defaults produce the matching compiled template values', () => {
  const expected = {
    avdSessionHostLocation: 'mexicocentral', avdManagementPlaneLocation: 'eastus2',
    avdHostPoolType: 'Personal', avdSessionHostDiskType: 'Premium_LRS',
    mpImageOffer: 'windows-11', mpImageSku: 'win11-24h2-avd',
    availability: 'AvailabilityZones', availabilityZones: ['1', '2'],
    createAvdFslogixDeployment: false, createAvdVnet: true,
    avdVnetworkAddressPrefixes: '10.131.0.0/16',
    vNetworkAvdSubnetAddressPrefix: '10.131.17.0/24',
    vNetworkPrivateEndpointSubnetAddressPrefix: '10.131.16.0/24',
    deployAvdPrivateLinkService: true, createPrivateDnsZones: true,
    avdDeployMonitoring: false, avdDeploySessionHosts: true,
    avdDeploySessionHostsCount: 1
  };
  const value = state();
  for (const [name, wanted] of Object.entries(expected)) {
    assert.deepEqual(output(name, value), wanted, `Form output ${name}`);
    assert.deepEqual(template.parameters[name].defaultValue, wanted, `Compiled default ${name}`);
  }
  assert.equal(output('hostPoolPublicNetworkAccess', value), 'EnabledForClientsOnly');
  assert.equal(template.parameters.avdSessionHostsSize.defaultValue, 'Standard_D4ads_v5');
  assert.equal(control('sessionHostSize').recommendedSizes[0], 'Standard_D4ads_v5');
  assert.equal(evaluate(template.parameters.hostPoolPublicNetworkAccess.defaultValue, {
    ...functions, parameters: () => true
  }), 'EnabledForClientsOnly');
  assert.equal(evaluate(template.parameters.hostPoolPublicNetworkAccess.defaultValue, {
    ...functions, parameters: () => false
  }), 'Enabled');
});

test('Portal string conversion JSON-encodes existing strings unlike ARM string conversion', () => {
  assert.equal(uiEvaluate("[string('1')]", {}), '"1"');
  assert.equal(evaluate("[string('1')]", functions), '1');
  assert.equal(uiEvaluate('[string(1)]', {}), '1');
  assert.equal(uiEvaluate("[string(parse('[\"1\",\"2\"]'))]", {}), '["1","2"]');
});

for (const [selection, expected] of [
  [1, ['1']], ['1', ['1']], [['1'], ['1']], [[1], ['1']],
  [2, ['2']], ['2', ['2']], [['2'], ['2']], [[2], ['2']],
  [['1', '2'], ['1', '2']], [[1, 2], ['1', '2']], [['1', '2', '3'], ['1', '2', '3']]
]) {
  test(`saved zone expression normalizes ${JSON.stringify(selection)} to a flat string array`, () => {
    const value = state();
    value.sessionHosts.sessionHostsAvailabilitySection.availabilityZones = selection;
    const result = output('availabilityZones', value);
    assert.deepEqual(result, expected);
    assert.ok(result.every(zone => hostsTemplate.parameters.availabilityZones.allowedValues.includes(zone)));
    assert.equal(template.parameters.availabilityZones.type.toLowerCase(), 'array');
    assert.equal(hostsTemplate.parameters.availabilityZones.type.toLowerCase(), 'array');
  });
}

test('regional and no-session-host modes output an empty zone array', () => {
  const value = state();
  value.sessionHosts.sessionHostsAvailabilitySection.option = 'None';
  value.sessionHosts.sessionHostsAvailabilitySection.availabilityZones = undefined;
  assert.deepEqual(output('availabilityZones', value), []);
  assert.equal(uiEvaluate(control('availabilityZonesUnavailable').visible, value), true);
  value.sessionHosts.deploySessionHosts = false;
  assert.deepEqual(output('availabilityZones', value), []);
});

test('native zone choices are literal string identifiers matching the compiled array contract', () => {
  const allowed = control('availabilityZones').constraints.allowedValues;
  assert.ok(Array.isArray(allowed), 'Zone choices must not be a Portal expression.');
  assert.deepEqual(allowed, [
    { label: 'Zone 1', value: '1' },
    { label: 'Zone 2', value: '2' },
    { label: 'Zone 3', value: '3' }
  ]);
  assert.deepEqual(allowed.map(item => item.value), hostsTemplate.parameters.availabilityZones.allowedValues);
});

test('Edit parameters retains an array input while nested ARM validation still constrains logical IDs', () => {
  const parameter = template.parameters.availabilityZones;
  assert.equal(parameter.type, 'array');
  assert.deepEqual(parameter.defaultValue, ['1', '2']);
  assert.equal(Object.hasOwn(parameter, 'allowedValues'), false,
    'A top-level enum makes the generic Portal editor render a scalar dropdown for an array.');
  assert.equal(hostsTemplate.parameters.availabilityZones.type, 'array');
  assert.deepEqual(hostsTemplate.parameters.availabilityZones.allowedValues, ['1', '2', '3']);
  assert.deepEqual(hostsTemplate.parameters.availabilityZones.defaultValue, []);
  assert.ok(parameter.defaultValue.every(zone =>
    hostsTemplate.parameters.availabilityZones.allowedValues.includes(zone)));
});

test('baseline normalizes edited zone-array elements before nested allowed-ID validation', () => {
  assert.ok(hostsDeployment, 'The baseline must pass canonical zone IDs into the session-host deployment.');
  for (const [selection, expected] of [
    [[], []],
    [['1'], ['1']],
    [[2], ['2']],
    [['1', '2'], ['1', '2']],
    [[1, 2, 3], ['1', '2', '3']],
    [['"1"'], ['1']],
    [['"2"'], ['2']],
    [['"1"', '"2"'], ['1', '2']],
    [['"1"', '2', 3], ['1', '2', '3']]
  ]) {
    const context = armContext(template, { availabilityZones: selection });
    const result = context.evaluate(hostsDeployment.properties.parameters.availabilityZones.value);
    assert.deepEqual(result, expected, JSON.stringify(selection));
    assert.ok(result.every(zone => hostsTemplate.parameters.availabilityZones.allowedValues.includes(zone)));
  }
});

test('the reported quoted createArray operands reach VMs as logical zones 1 and 2', () => {
  const selection = evaluate(`[createArray('"1"', '"2"')]`, functions);
  assert.deepEqual(selection, ['"1"', '"2"']);
  assert.ok(selection.every(zone => !hostsTemplate.parameters.availabilityZones.allowedValues.includes(zone)));
  const context = armContext(template, { availabilityZones: selection });
  const zones = context.evaluate(hostsDeployment.properties.parameters.availabilityZones.value);
  assert.deepEqual(zones, ['1', '2']);
  const hosts = armContext(hostsTemplate, { availabilityZones: zones, availability: 'AvailabilityZones', count: 4 });
  const vm = hostsTemplate.resources.find(value => value.copy?.name === 'sessionHosts');
  const assigned = Array.from({ length: 4 }, (_, index) => {
    hosts.indices.set('', index);
    return hosts.evaluate(vm.properties.parameters.zone).value;
  });
  assert.deepEqual(assigned, [1, 2, 1, 2]);
});

test('zone normalization retains validation for invalid IDs and does not evaluate parameter expression text', () => {
  for (const selection of [
    ['0'], [4], ['01'], ['1.5'], [1.5], ['"4"'], ['"1.5"'], ['1"'], ['1"2'], [JSON.stringify('"1"')],
    ['["1","2"]'], ["[createArray('1','2')]"], [{ value: '1' }], [null]
  ]) {
    const context = armContext(template, { availabilityZones: selection });
    const result = context.evaluate(hostsDeployment.properties.parameters.availabilityZones.value);
    assert.ok(result.some(zone => !hostsTemplate.parameters.availabilityZones.allowedValues.includes(zone)),
      JSON.stringify(selection));
  }
  const context = armContext(template, { availabilityZones: ['"1'] });
  assert.throws(() => context.evaluate(hostsDeployment.properties.parameters.availabilityZones.value), SyntaxError);
});

test('missing or paged SKU data cannot remove Availability Zones or change the zonal default', () => {
  const value = state();
  for (const response of [undefined, { value: [] }, {
    value: [{ name: 'Standard_D4ads_v5_extra', locationInfo: [] }],
    nextLink: 'https://management.azure.com/sku-next-page'
  }]) {
    value.sessionHosts.sessionHostsRegionSection.resourceSkusApi = response;
    assert.deepEqual(uiEvaluate(control('option').constraints.allowedValues, value).map(item => item.value),
      ['AvailabilityZones', 'None']);
    assert.equal(defaultValue('option', value), 'AvailabilityZones');
    assert.deepEqual(uiEvaluate(control('availabilityZones').constraints.allowedValues, value).map(item => item.value),
      ['1', '2', '3']);
  }
  assert.equal(JSON.stringify(form).includes('resourceSkusApi'), false);
});

test('native zone defaults select 1 and 2 without lookup or default expressions', () => {
  const value = state();
  const element = control('availabilityZones');
  assert.deepEqual(element.defaultValue, [{ value: '1' }, { value: '2' }]);
  assert.equal(element.multiselect, true);
  assert.equal(element.selectAll, true);
  assert.equal(element.constraints.required, true);
  assert.deepEqual(defaultValue('availabilityZones', value), ['1', '2']);
});

test('zone choices remain nonempty before region and subscription data are available', () => {
  const value = state();
  for (const response of [undefined, {}, { error: { code: 'AuthorizationFailed' } }, { value: [] }]) {
    value.basics.resourceScope.subscription = undefined;
    value.sessionHosts.sessionHostsRegionSection.computeApi = response;
    value.sessionHosts.sessionHostsRegionSection.sessionHostsRegion = undefined;
    assert.equal(defaultValue('option', value), 'AvailabilityZones');
    assert.deepEqual(uiEvaluate(control('availabilityZones').constraints.allowedValues, value).map(item => item.value),
      ['1', '2', '3']);
    assert.deepEqual(defaultValue('availabilityZones', value), ['1', '2']);
  }
});

test('the form has no legacy regional zone API or expression-based lookup warning', () => {
  for (const name of ['locationZonesApi', 'availabilityZonesLookupWarning']) {
    assert.equal([...objects(form)].some(element => element.name === name), false);
    assert.equal(JSON.stringify(form).includes(name), false);
  }
});

test('manual zone identifiers do not replace the required region selection or SKU verification', () => {
  const value = state();
  for (const region of [undefined, null, '', 'mexicocentral', 'eastus2']) {
    value.sessionHosts.sessionHostsRegionSection.sessionHostsRegion = region;
    assert.deepEqual(uiEvaluate(control('availabilityZones').constraints.allowedValues, value).map(item => item.value),
      ['1', '2', '3']);
    assert.equal(uiEvaluate(control('availabilityZonesSkuWarning').visible, value), true);
    assert.equal(uiEvaluate(control('confirmZonalSkuAvailability').visible, value), true);
  }
  assert.equal(control('sessionHostsRegion').constraints.required, true);
  assert.equal(control('confirmZonalSkuAvailability').constraints.required, true);
});

test('zonal selection explicitly requires verification instead of treating manual identifiers as SKU availability', () => {
  const value = state();
  assert.equal(uiEvaluate(control('availabilityZonesSkuWarning').visible, value), true);
  assert.equal(uiEvaluate(control('confirmZonalSkuAvailability').visible, value), true);
  assert.equal(control('confirmZonalSkuAvailability').constraints.required, true);
  assert.equal(Object.hasOwn(control('confirmZonalSkuAvailability'), 'defaultValue'), false);
  value.sessionHosts.sessionHostsAvailabilitySection.option = 'None';
  assert.equal(uiEvaluate(control('availabilityZonesSkuWarning').visible, value), false);
  assert.equal(uiEvaluate(control('confirmZonalSkuAvailability').visible, value), false);
});

test('Marketplace filtering exactly matches the original AVD-only expression for Personal and Pooled', () => {
  const originalFilter = "[map(filter(steps('sessionHosts').sessionHostsOsSection.skusApi, (sku) => and(startsWith(sku.name, 'win'), not(contains(sku.name, 'ent')), or(contains(sku.name, 'ent'), contains(sku.name, 'avd')))), (sku) => parse(concat('{\"label\":\"', sku.name, '\",\"value\":\"', sku.name, '\"}')))]";
  assert.equal(control('sku').constraints.allowedValues, originalFilter);
  const avd = ['win11-23h2-avd', 'win11-24h2-avd', 'win11-25h2-avd', 'win11-26h2-avd'];
  for (const type of ['Personal', 'Pooled']) {
    const value = state();
    value.managementPlane.managementPlaneHostPoolSettings.hostPoolType = type;
    value.sessionHosts.sessionHostsOsSection.skusApi = [
      ...avd, 'win11-24h2-ent', 'win11-24h2-pro', 'win11-24h2-home', 'win11-24h2-avd-ent'
    ].map(name => ({ name }));
    const values = uiEvaluate(control('sku').constraints.allowedValues, value).map(item => item.value);
    assert.deepEqual(values, avd);
    assert.equal(defaultValue('sku', value), 'win11-24h2-avd');
    assert.equal(output('mpImageSku', value), 'win11-24h2-avd');
  }
});

test('Create new private DNS is the native form default and does not request existing zone IDs', () => {
  const value = state();
  assert.equal(control('virtualNetworkPrivateDnsZone').defaultValue, 'Create new');
  assert.equal(defaultValue('virtualNetworkPrivateDnsZone', value), true);
  assert.equal(template.parameters.createPrivateDnsZones.defaultValue, true);
  assert.equal(output('createPrivateDnsZones', value), true);
  assert.equal(uiEvaluate(control('virtualNetworkPrivateDnsZoneSelection').visible, value), false);
  assert.equal(uiEvaluate(control('privateDNSZonesApi').condition, value), false);
  for (const name of ['avdVnetPrivateDnsZoneFilesId', 'avdVnetPrivateDnsZoneKeyvaultId',
    'avdVnetPrivateDnsZoneDiscoveryResourceId', 'avdVnetPrivateDnsZoneConnectionResourceId']) {
    assert.equal(output(name, value), '');
  }
});

test('explicit existing private DNS choices and disabled private endpoints are not overridden by the new-zone default', () => {
  const value = state();
  const prefix = `/subscriptions/${value.basics.resourceScope.subscription.subscriptionId}/resourceGroups/rg-dns/providers/Microsoft.Network/privateDnsZones/`;
  const names = {
    avdVnetPrivateDnsZoneFilesId: ['azureFilesPrivateDnsZone', 'privatelink.file.core.windows.net'],
    avdVnetPrivateDnsZoneKeyvaultId: ['azureKeyVaultPrivateDnsZone', 'privatelink.vaultcore.azure.net'],
    avdVnetPrivateDnsZoneDiscoveryResourceId: ['avdDiscoveryPrivateDnsZone', 'privatelink-global.wvd.microsoft.com'],
    avdVnetPrivateDnsZoneConnectionResourceId: ['avdConnectionPrivateDnsZone', 'privatelink.wvd.microsoft.com']
  };
  assert.deepEqual(control('virtualNetworkPrivateDnsZone').constraints.allowedValues, [
    { label: 'Create new', value: true }, { label: 'Use existing', value: false }
  ]);
  value.network.virtualNetworkPrivateDnsZone = false;
  value.network.deployPrivateEndpointKeyvaultStorage = true;
  value.network.virtualNetworkPrivateDnsZoneSelection = Object.fromEntries(
    Object.values(names).map(([controlName, zone]) => [controlName, `${prefix}${zone}`]));
  assert.equal(output('createPrivateDnsZones', value), false);
  assert.equal(uiEvaluate(control('virtualNetworkPrivateDnsZoneSelection').visible, value), true);
  assert.equal(uiEvaluate(control('privateDNSZonesApi').condition, value), true);
  for (const [name, [, zone]] of Object.entries(names)) {
    assert.equal(output(name, value), `${prefix}${zone}`);
  }
  value.network.virtualNetworkPrivateDnsZone = true;
  value.network.deployPrivateEndpointKeyvaultStorage = false;
  value.network.deployAvdPrivateLinkService = false;
  assert.equal(output('createPrivateDnsZones', value), false);
  assert.equal(uiEvaluate(control('virtualNetworkPrivateDnsZone').visible, value), false);
  assert.equal(uiEvaluate(control('privateDNSZonesApi').condition, value), false);
});

test('retention validates every integer from 30 through 730 and exports an integer', () => {
  const regex = new RegExp(control('deployMonitoringNewAlaWorkspaceRetention').constraints.regex);
  for (let days = 30; days <= 730; days++) assert.ok(regex.test(String(days)), String(days));
  for (const invalid of ['', '29', '731', '90.5', 'abc', '-1', ' 90', '0090']) {
    assert.equal(regex.test(invalid), false, invalid);
  }
  const value = state();
  assert.equal(output('avdAlaWorkspaceDataRetention', value), 0);
  value.monitoring.deployMonitoring = true;
  assert.equal(output('avdAlaWorkspaceDataRetention', value), 90);
  assert.equal(template.parameters.avdAlaWorkspaceDataRetention.type, 'int');
});

test('deployment scope exports an ARM ID without duplicating the workload subscription override', () => {
  for (const name of Object.keys(form.view.outputs.parameters)) assert.ok(Object.hasOwn(template.parameters, name), name);
  const value = state();
  assert.equal(form.view.outputs.kind, 'Subscription');
  assert.equal(uiEvaluate(form.view.outputs.location, value), 'eastus2');
  assert.equal(uiEvaluate(form.view.outputs.subscriptionId, value),
    `/subscriptions/${value.basics.resourceScope.subscription.subscriptionId}`);
  assert.match(uiEvaluate(form.view.outputs.subscriptionId, value),
    /^\/subscriptions\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i);
  assert.equal(Object.hasOwn(form.view.outputs.parameters, 'avdWorkloadSubsId'), false);
  assert.equal(control('resourceScope').type, 'Microsoft.Common.ResourceScope');
  for (const name of ['avdVirtualNetworkSelectorId', 'privateEndpointVirtualNetworkSelectorId',
    'alaWorkspaceExistingWorkspacesSelection']) {
    const element = control(name);
    assert.equal(uiEvaluate(element.scope.subscriptionId, value), value.basics.resourceScope.subscription.subscriptionId);
  }
});

test('workload subscription defaults to the deployment selection and reaches every subscription-bearing module', () => {
  assert.equal(template.parameters.avdWorkloadSubsId.defaultValue, '[subscription().subscriptionId]');
  assert.equal(template.parameters.avdWorkloadSubsId.metadata.ignore, true);
  assert.ok(workloadSubscriptionDependency, 'Exercise a generated subscriptionResourceId dependency.');
  for (const subscriptionId of [
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002'
  ]) {
    const context = armContext(template, { time: 'scope-check' }, subscriptionId);
    assert.ok(context.evaluate(workloadSubscriptionDependency).startsWith(`/subscriptions/${subscriptionId}/providers/`));
    let checked = 0;
    for (const resource of template.resources) {
      for (const name of ['subscriptionId', 'workloadSubsId']) {
        const parameter = resource.properties?.parameters?.[name];
        if (!parameter) continue;
        assert.equal(context.evaluate(parameter.value), subscriptionId, `${resource.name}: ${name}`);
        checked++;
      }
    }
    assert.ok(checked > 0);
  }
});

test('an explicit cross-subscription workload override does not change the deployment record subscription', () => {
  const deploymentSubscriptionId = '00000000-0000-4000-8000-000000000001';
  const workloadSubscriptionId = '00000000-0000-4000-8000-000000000002';
  const context = armContext(template, { avdWorkloadSubsId: workloadSubscriptionId, time: 'scope-check' },
    deploymentSubscriptionId);
  assert.equal(context.evaluate('[subscription().subscriptionId]'), deploymentSubscriptionId);
  assert.ok(context.evaluate(workloadSubscriptionDependency)
    .startsWith(`/subscriptions/${workloadSubscriptionId}/providers/`));
});

test('an explicit blank workload subscription remains invalid instead of falling back to another scope', () => {
  const context = armContext(template, { avdWorkloadSubsId: '', time: 'scope-check' },
    '00000000-0000-4000-8000-000000000001');
  assert.throws(() => context.evaluate(workloadSubscriptionDependency), /value '' is not valid subscription identifier/);
  assert.equal(template.parameters.avdWorkloadSubsId.minLength, 1);
  assert.equal(template.parameters.avdWorkloadSubsId.maxLength, 36);
});

test('baseline parameter samples inherit the selected subscription instead of sending a blank override', () => {
  for (const name of ['deploy-baseline-all.bicepparam', 'deploy-baseline-required-only.bicepparam']) {
    assert.doesNotMatch(read('workload', 'bicep', 'parameters', name), /^param avdWorkloadSubsId\s*=/m, name);
  }
});

test('generated JSON parameter examples omit the ARM-evaluated subscription default', () => {
  const reference = read('workload', 'docs', 'autoGenerated', 'deploy-baseline.bicep.md');
  const samples = [...reference.matchAll(/```json\r?\n([\s\S]*?)\r?\n```/g)]
    .map(match => JSON.parse(match[1]));
  const parameters = samples.find(value => value.$schema?.includes('deploymentParameters.json'));
  assert.ok(parameters, 'Check the generated JSON parameter-file example, not only the parameter description.');
  assert.equal(Object.hasOwn(parameters.parameters, 'avdWorkloadSubsId'), false);
  assert.match(reference, /avdWorkloadSubsId \| No\s+\|/);
});

test('one editable native region drives both deployment review and AVD management while VM location stays separate', () => {
  const value = state();
  assert.deepEqual(control('resourceScope').location.resourceTypes, ['Microsoft.DesktopVirtualization/workspaces']);
  assert.equal(Object.hasOwn(control('resourceScope').location, 'defaultValue'), false);
  for (const name of ['managementPlaneLocation', 'managementPlaneApi']) {
    assert.equal([...objects(form)].some(element => element.name === name), false);
    assert.equal(JSON.stringify(form).includes(`steps('basics').${name}`), false);
  }
  for (const [name, displayName] of [['eastus2', 'East US 2'], ['westus2', 'West US 2']]) {
    value.basics.resourceScope.location = { name, displayName };
    assert.equal(uiEvaluate(form.view.outputs.location, value), name);
    assert.equal(output('avdManagementPlaneLocation', value), name);
    assert.equal(output('avdSessionHostLocation', value), 'mexicocentral');
    value.sessionHosts.deploySessionHosts = false;
    assert.equal(output('avdSessionHostLocation', value), name);
    for (const selector of ['avdVirtualNetworkSelectorId', 'privateEndpointVirtualNetworkSelectorId']) {
      assert.equal(uiEvaluate(control(selector).scope.location, value), name);
    }
    value.sessionHosts.deploySessionHosts = true;
  }
  value.basics.resourceScope.location = undefined;
  assert.equal(uiEvaluate(form.view.outputs.location, value), undefined);
  assert.equal(output('avdManagementPlaneLocation', value), undefined);
});

test('China feature gating follows the shared editable management region', () => {
  const value = state();
  value.managementPlane.managementPlaneHostPoolScaling = { scalingPlan: true };
  value.storage.storageAppAttach.appAttachStorageDeployment = true;
  value.basics.resourceScope.location = { name: 'chinaeast2' };
  assert.equal(output('avdDeployScalingPlan', value), false);
  assert.equal(output('createAppAttachDeployment', value), false);
  value.basics.resourceScope.location = { name: 'eastus2' };
  assert.equal(output('avdDeployScalingPlan', value), true);
  assert.equal(output('createAppAttachDeployment', value), true);
});

test('pending VM region-provider responses cannot dereference missing location data', () => {
  const value = state();
  for (const response of [undefined, {}, { error: { code: 'AuthorizationFailed' } }, { value: [] },
    { value: [{ resourceType: 'workspaces' }, { resourceType: 'virtualMachines' }] }]) {
    value.sessionHosts.sessionHostsRegionSection.computeApi = response;
    assert.deepEqual(uiEvaluate(control('sessionHostsRegion').constraints.allowedValues, value), []);
    assert.equal(control('sessionHostsRegion').constraints.required, true);
  }
});

test('disabled storage and missing zone mappings do not read an undefined location during review', () => {
  const value = state();
  assert.deepEqual(uiEvaluate(control('storageGeneralSettingsZoneRedundancy').constraints.allowedValues, value),
    [{ label: 'Locally Redundant Storage', value: false }]);
  assert.equal(uiEvaluate(control('storageApi').condition, value), false);
  value.storage.storageFslogix.fslogixDeployment = true;
  for (const response of [undefined, {}, { value: [] }, { value: [{ resourceType: 'storageAccounts' }] },
    { value: [{ resourceType: 'storageAccounts', zoneMappings: [undefined, {}, { zones: ['1', '2', '3'] }] }] }]) {
    value.storage.storageGeneralSettings.storageApi = response;
    assert.deepEqual(uiEvaluate(control('storageGeneralSettingsZoneRedundancy').constraints.allowedValues, value),
      [{ label: 'Locally Redundant Storage', value: false }]);
  }
  value.storage.storageGeneralSettings.storageApi = { value: [{
    resourceType: 'storageAccounts', zoneMappings: [{ location: 'Mexico Central', zones: ['1', '2', '3'] }]
  }] };
  assert.deepEqual(uiEvaluate(control('storageGeneralSettingsZoneRedundancy').constraints.allowedValues, value),
    [{ label: 'Locally Redundant Storage', value: false }, { label: 'Zone-Redundant Storage', value: true }]);
});

test('credentials and tenant-specific enterprise application IDs remain customer inputs', () => {
  for (const name of ['avdVmLocalUserName', 'avdVmLocalUserPassword']) {
    assert.equal(Object.hasOwn(template.parameters[name], 'defaultValue'), false, name);
  }
  assert.equal(template.parameters.avdVmLocalUserPassword.type.toLowerCase(), 'securestring');
  assert.equal(template.parameters.avdServicePrincipalObjectId.defaultValue, '');
});

test('generated VM zone assignment consumes one or several zones round-robin', () => {
  const module = hostsTemplate.resources.find(value => value.copy?.name === 'sessionHosts');
  for (const [zones, expected] of [
    [['1'], [1, 1, 1, 1]],
    [['2'], [2, 2, 2, 2]],
    [['1', '2'], [1, 2, 1, 2]],
    [['1', '2', '3'], [1, 2, 3, 1]]
  ]) {
    const context = armContext(hostsTemplate, { availabilityZones: zones, availability: 'AvailabilityZones', count: 4 });
    assert.deepEqual(context.variables('varZones'), zones.map(Number));
    const assigned = Array.from({ length: 4 }, (_, index) => {
      context.indices.set('', index);
      return context.evaluate(module.properties.parameters.zone).value;
    });
    assert.deepEqual(assigned, expected);
  }
});

test('every initiative child is remediated against the correct resource-group assignment', () => {
  const remediation = policyTemplate.resources.find(value => value.copy?.name === 'policySetRemediation');
  for (const [network, storage, groups] of [['', '', 2], ['rg-network', '', 3], ['rg-network', 'rg-storage', 4]]) {
    const context = armContext(policyTemplate, {
      subscriptionId: 'test-subscription', computeObjectsRgName: 'rg-compute',
      serviceObjectsRgName: 'rg-service', networkObjectsRgName: network, storageObjectsRgName: storage
    });
    const definitions = context.variables('varCustomPolicySetDefinitions');
    const references = definitions.libSetChildDefinitions.map(value => value.definitionReferenceId);
    assert.equal(references.length, 9);
    assert.equal(new Set(references).size, 9);
    const items = context.variables('varPolicyRemediations');
    assert.equal(items.length, groups * references.length);
    assert.equal(context.evaluate(remediation.copy.count), items.length);
    for (let index = 0; index < items.length; index++) {
      context.indices.set('', index);
      const item = items[index];
      assert.equal(context.evaluate(remediation.resourceGroup), item.rgName);
      assert.equal(context.evaluate(remediation.properties.parameters.policyDefinitionReferenceId.value),
        references[index % references.length]);
      assert.equal(context.evaluate(remediation.properties.parameters.policyAssignmentId.value),
        `/subscriptions/test-subscription/resourceGroups/${item.rgName}/providers/Microsoft.Authorization/policyAssignments/${definitions.libSetDefinition.name}`);
    }
    assert.ok(remediation.dependsOn.includes('policySetAssignment'));
  }
});

test('AMA explicitly waits for VM creation even when the antimalware deployment is conditional', () => {
  const ama = hostsTemplate.resources.find(value => value.copy?.name === 'ama');
  assert.ok(ama.dependsOn.includes('sessionHosts'));
  assert.ok(ama.dependsOn.includes('sessionHostsAntimalwareExtension'));
  assert.equal(ama.condition, "[parameters('deployMonitoring')]");
});

test('Mexico naming and Windows time zone are defined and approved subnet ranges fit without overlap', () => {
  const locations = JSON.parse(read('workload', 'variables', 'locations.json'));
  assert.deepEqual(locations.mexicocentral, {
    acronym: 'mxc', timeDifference: '-6:00', timeZone: 'Central Standard Time (Mexico)'
  });
  const range = cidr => {
    const [address, prefix] = cidr.split('/');
    const start = address.split('.').reduce((result, part) => result * 256 + Number(part), 0);
    return [start, start + 2 ** (32 - Number(prefix)) - 1];
  };
  const vnet = range(template.parameters.avdVnetworkAddressPrefixes.defaultValue);
  const hosts = range(template.parameters.vNetworkAvdSubnetAddressPrefix.defaultValue);
  const endpoints = range(template.parameters.vNetworkPrivateEndpointSubnetAddressPrefix.defaultValue);
  for (const subnet of [hosts, endpoints]) assert.ok(subnet[0] >= vnet[0] && subnet[1] <= vnet[1]);
  assert.ok(hosts[1] < endpoints[0] || endpoints[1] < hosts[0]);
});

test('commercial baseline buttons load both fork artifacts without redirecting optional deployments', () => {
  for (const parts of [['readme.md'], ['workload', 'docs', 'deploy-baseline.md'],
    ['workload', 'docs', 'getting-started-baseline.md']]) {
    const links = read(...parts).match(/https:\/\/portal\.azure\.com\/#blade\/Microsoft_Azure_CreateUIDef\/CustomDeploymentBlade\/uri\/[^)]+/g);
    assert.ok(links?.length, parts.join('\\'));
    for (const link of links) {
      const [arm, ui] = link.split('/uri/')[1].split('/uiFormDefinitionUri/').map(decodeURIComponent);
      if (arm.endsWith('/deploy-baseline.json')) {
        assert.equal(arm, 'https://raw.githubusercontent.com/gracielars999/avdaccelerator/main/workload/arm/deploy-baseline.json');
        assert.equal(ui, 'https://raw.githubusercontent.com/gracielars999/avdaccelerator/main/workload/portal-ui/portal-ui-baseline.json');
      } else {
        assert.ok(arm.startsWith('https://raw.githubusercontent.com/Azure/avdaccelerator/'));
      }
    }
  }
});
