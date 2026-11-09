using '../deploy-baseline.bicep'

// Supply credentials through the process environment; never commit their values.
param avdVmLocalUserName = readEnvironmentVariable('AVD_VM_LOCAL_USERNAME')
param avdVmLocalUserPassword = readEnvironmentVariable('AVD_VM_LOCAL_PASSWORD')
