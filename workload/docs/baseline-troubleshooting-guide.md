# Troubleshooting Guide: Azure Virtual Desktop Landing Zone Accelerator

## Portal validation: Cannot read properties of undefined (reading 'location')

If the error is a `TypeError` in the `Microsoft_Azure_CreateUIDef` extension with `getFormTemplateDeploymentOptions` in its stack, it occurs during the Portal's form-to-deployment conversion, before ARM validation. It is not evidence of a monitoring-policy permission failure.

For a subscription deployment, Portal's `view.outputs.subscriptionId` must be a subscription **ARM ID**, `/subscriptions/<subscription-id>`, not the bare GUID. The reported converter parses that ID to build its deployment scope; an invalid scope can leave that object undefined before its `location` is read. This fork constructs the ARM ID from the selected subscription GUID for the deployment output. Resource/API picker scopes use the GUID, and the template's `avdWorkloadSubsId` inherits the GUID from the actual deployment subscription unless explicitly overridden.

Close an older deployment tab and reopen the newly published form; existing tabs or commit-pinned links keep the older output expression. Select the subscription and shared deployment/management region, then run **Review + create** again. Publication and offline contract checks do not constitute a successful live Portal validation or customer deployment. If the error persists with the new version, collect the full error JSON and form version without sharing credentials or access tokens.

## InvalidTemplate: subscription identifier is empty

The message `The provided value '' is not valid subscription identifier` means a resource-ID expression received an empty subscription value, not that the deployer lacks a role. The baseline's generated `subscriptionResourceId(...)` dependencies use `avdWorkloadSubsId` or a forwarded `subscriptionId`; older parameter samples explicitly supplied `avdWorkloadSubsId = ''`. Selecting a subscription for the deployment does not by itself populate a separately required template parameter.

The baseline now defaults `avdWorkloadSubsId` to `subscription().subscriptionId`, using the actual customer-selected deployment scope without embedding a customer ID. The custom form omits the duplicate override, both parameter samples inherit the default, and explicit blanks are disallowed. Cross-subscription deployments can still supply an intentional workload subscription GUID with the required permissions at both scopes.

With the corrected template, remove an old `"avdWorkloadSubsId": { "value": "" }` entry from a JSON parameter file to inherit the deployment selection, or replace it with the intended GUID for an explicit override. Do not supply `/subscriptions/<guid>` as this parameter. An explicit empty string is not equivalent to omitting the parameter and does not activate its default; see the [subscriptionResourceId reference](https://learn.microsoft.com/azure/azure-resource-manager/templates/template-functions-resource#subscriptionresourceid). Reopen the corrected deployment link rather than reusing an old saved blank payload. Offline validation does not establish a successful customer deployment.

## InvalidParameter: osProfile.adminUsername is missing

This error means the VM received no usable local administrator username. It does not by itself identify why the input was lost or prove an RBAC or Entra join problem. In **Identity provider > Session host local admin credentials**, provide the required **Username** and password, even when Microsoft Entra ID is the identity provider. Supply a local account name, not an Entra UPN. For an existing VM, use its original administrator username; this is not an in-place account rename.

The username control, required constraint and direct output expression match the [original accelerator](https://github.com/Azure/avdaccelerator/blob/4ab656e10a8ee7eac861c235675c86e4d1abd7f4/workload/portal-ui/portal-ui-baseline.json): `Microsoft.Common.TextBox` supplies `avdVmLocalUserName`; the separate Windows `CredentialsCombo` supplies only the password. This restores the original text box instead of substituting a `UserNameTextBox`. The baseline writes the entered username as the workload Key Vault's `vmLocalUserName` secret; the session-host module references that secret for the VM module's `adminUsername`, which feeds `osProfile.adminUsername`. The baseline credential parameters and VM administrator parameter reject empty strings before a VM request. No fallback account or default password is added.

When redeploying, check the template version and deployment level. Secure inputs are not returned as plaintext in deployment history; re-enter required credentials or retain the intended Key Vault references rather than accepting blank secure fields. The Bicep parameter samples require `AVD_VM_LOCAL_USERNAME` and `AVD_VM_LOCAL_PASSWORD` from the current process environment with no fallback; their compiled JSON can contain the supplied password and must remain private. Never post passwords, secret values or unredacted parameter files to diagnose this error. Offline wiring checks do not confirm which input the failed customer deployment submitted.

## InvalidTemplate: avdVmLocalUserName does not meet the minimum length

`Length of the value should be greater than or equal to '1'` means template validation is evaluating an empty username. If it appears immediately when opening the form, before entering credentials, it is not evidence that an entered username was lost or that a VM deployment failed. If it appears after submitting a populated form, inspect the final parameter transport as described below. Keep the required-input check; do not configure a default account to bypass it. The original form also requires the local username explicitly; neither the signed-in Azure user nor the domain-join account supplies it.

Open the newly published, commit-pinned accelerator form rather than an older tab. The restored **Identity > Session host local admin credentials > Username** control and its output match upstream exactly. A populated field with a validation checkmark is not evidence that the final request contains that value. Matching source and offline Portal conversion checks do not prove why a particular customer's typed input was lost or establish that a live customer submission now succeeds. If the field is populated but the error persists, record the template/form version and validation stage, and inspect only whether the submitted `avdVmLocalUserName` is present and non-empty. Do not share its value, the password or an unredacted parameter payload.

## Redeploy: Data Disks says the value must not be empty

`Data Disks` is an optional array in the internal VM module, not a top-level baseline parameter. Its nullable type has an implicit `null` default, which can leave the generic Portal redeployment editor blank when the caller omits it. The baseline now explicitly supplies `[]` in both session-host and temporary management-VM calls, so their deployment parameters contain an array. The generic module remains compatible with other callers: empty arrays and explicit legacy `null` inputs both still produce no data disks, and non-empty disk arrays keep their existing behavior.

For a VM with no data disks, enter the JSON array `[]` rather than an empty text box; do not add a disk just to satisfy the editor. If a VM already has intentional data disks, retain those definitions instead of replacing them with `[]`. Opening an old deployment's **Redeploy** screen does not download the newly published template: use the updated accelerator entrypoint for a full deployment, or deliberately load the corrected VM template for a nested redeployment. The custom baseline form and a nested VM parameter editor expose different inputs.

## Availability zone array becomes a scalar in Edit parameters

The standard ARM **Edit parameters** screen is not the accelerator's custom multi-select form. An array parameter with a top-level `allowedValues` list can appear there as a single-choice dropdown, with the warning that its array default is not present in the allowed list. Choosing `2` in that dropdown can submit a scalar even though the template requires an array.

The baseline keeps `availabilityZones` as an array, defaults it to `["1", "2"]`, and moves its allowed logical string IDs (`"1"`, `"2"`, `"3"`) to the nested session-host template. This avoids the top-level enum control without removing the nested ARM constraint. The custom form uses literal zone choices and continues to normalize one or multiple selections to an array of strings.

In Portal controls, select plain zone IDs and retain the array input; do not add quote characters to each entry or type a `createArray(...)` expression. A **JSON parameter file** must use `"availabilityZones": { "value": ["1", "2"] }`, not a scalar or comma-separated string. For regional VMs, explicitly set `availability` to `None` and the zone array to `[]`. Reopen the newly published template; old tabs and commit-pinned URLs retain the previous parameter schema. These structural corrections still require a fresh customer Portal test.

## Availability zone validation rejects quoted createArray operands

An `InvalidTemplate` error containing `[createArray('\"1\"', '\"2\"')]` reports IDs with literal quote characters, equivalent to `["\"1\"", "\"2\""]`, rather than the allowed IDs `["1", "2"]`. This is a serialization issue, not a missing Azure role. The Portal's public CreateUiDefinition conversion callback uses JSON serialization for `string()`, so mapping it directly over string IDs adds quotes. The previous offline checks incorrectly reused ARM string-conversion behavior and missed that difference.

The custom form now converts each supported ID to a number before applying `string()`, producing plain string IDs for single and multiple selections. The baseline separately decodes exactly one JSON string layer on edited array entries before nested allowed-ID validation; it does not strip arbitrary characters, evaluate parameter text as ARM expressions, remove the zone constraint, or change the parameter to an integer. Reopen the corrected deployment link instead of reusing an old tab or saved quoted payload. Regression checks replay the quoted operands and the generated per-VM zone assignment; they are not evidence of a successful Azure deployment.

## Portal cannot create the availabilityZones DropDown

`Failed to create element of type: 'Microsoft.Common.DropDown' named 'sessionHostsAvailabilitySection,availabilityZones'` is a form-control construction error, not an ARM zone-array or Azure permission error. The zone field now initializes with `["Zone 1", "Zone 2"]`, following the [original accelerator's label-array format](https://github.com/Azure/avdaccelerator/blob/4ab656e10a8ee7eac861c235675c86e4d1abd7f4/workload/portal-ui/portal-ui-baseline.json), rather than object-valued defaults. Its allowed values remain the literal IDs `"1"`, `"2"` and `"3"`, and its output remains an array of IDs for one or multiple selections.

The [DropDown documentation](https://learn.microsoft.com/azure/azure-resource-manager/managed-applications/microsoft-common-dropdown) describes both label-based and object-valued defaults. This source-alignment change does not by itself establish the customer's inner JavaScript exception. Open the newly published commit-pinned form; an existing tab retains the old definition. If the construction error persists, capture its inner exception/stack and the template, form and Portal versions, without sharing credentials, tokens or an unredacted parameter payload. A username minimum-length warning shown before entering credentials is not proof that a populated username was lost; investigate form conversion errors before attributing it to the credentials field.

A separate output-conversion failure was reproduced with Portal's actual expression evaluator: unlike ARM, its `if()` evaluates both branches. The previous zone expression called `int()` on the whole array in its unselected scalar branch, which throws even for the default zones `["1", "2"]`. In isolated production-mode replay, the serializer returned an empty parameter object even with a populated synthetic local username. The corrected expression selects JSON text first, parses the selected text once, and only converts individual IDs inside `map()`. Offline checks exercise eager branches as well as native dropdown initialization and parameter conversion; they do not establish the inner exception behind the customer's control-construction message.

## Invalid LoadBalancer and Hostpool Type combination

`LoadBalancerType: BreadthFirst not consistent with HostPoolType: Personal` is a host-pool property mismatch, not an RBAC, VM-region or session-host image error. Personal pools require `Persistent`. `BreadthFirst` and `DepthFirst` apply to Pooled pools, as shown in [Microsoft's host-pool creation examples](https://learn.microsoft.com/azure/virtual-desktop/deploy-azure-virtual-desktop).

The form now exports `Persistent` for Personal even though its hidden Pooled algorithm selector retains its own default. The baseline's parameter default also follows the selected pool type, and the management-plane module enforces `Persistent` before calling the host-pool module, including when a saved Personal payload still contains `BreadthFirst` or `DepthFirst`. Pooled defaults and explicit `DepthFirst` choices are preserved.

Open the newly published template and form together. An old tab, commit-pinned link or deployment-history **Redeploy** retains the old definition and may still forward the incompatible value. Keep the intended Personal pool type; do not convert an existing pool to Pooled or delete customer resources to bypass the error. This source correction is not evidence that a customer deployment has completed successfully.

## AADLoginForWindows: Entra device join failed

A failure of the `AADLogin` extension (`Microsoft.Azure.ActiveDirectory/AADLoginForWindows`) is an Entra device-join failure, not a monitoring-policy deployment failure. The reported signed status `-2145648526` converts to HRESULT `0x801C0072`; that value alone does not establish a permissions, networking, image or Intune root cause. Do not substitute the documented meanings of other HRESULTs. "Device successfully unjoined" describes cleanup after the failure, not a successful join.

The session-host source enables a system-assigned identity for Entra identity providers and only adds Intune's `mdmId` when `createIntuneEnrollment` is enabled. Verify the deployed VM's actual identity, image and extension settings rather than assuming it used the current form defaults. A Personal host-pool assignment and an AVD-only image filter do not prove the reason a join failed.

Start with read-only Resource Health, VM/agent state and extension status. A deallocated VM or missing agent/extension status cannot provide a fresh guest diagnosis and does not prove that the earlier failure is resolved. Do not start, redeploy, replace, rejoin or rerun extensions without customer approval.

Using an approved existing guest-access method, collect the failure-time `CommandExecution.log` (or its timestamped copy) under `C:\WindowsAzure\Logs\Plugins\Microsoft.Azure.ActiveDirectory.AADLoginForWindows\<version>\`, plus the related **User Device Registration/Admin** events and `dsregcmd /status`. Preserve the inner server error, failure phase and correlation ID; redact credentials, access tokens and other unnecessary customer identifiers. Check system-assigned identity/IMDS tenant information and required Entra DNS/HTTPS reachability. If Intune enrollment was enabled, also check the tenant's enrollment configuration and prerequisites; do not silently disable enrollment as a purported fix.

Follow [Microsoft's Windows VM Entra sign-in deployment troubleshooting](https://learn.microsoft.com/entra/identity/devices/howto-vm-sign-in-azure-ad-windows#troubleshoot-deployment-problems). That guidance lists the required endpoint checks and distinguishes join failures from later user-login RBAC failures. Do not share the managed-identity token returned by its diagnostic commands. The generic extension error, without guest evidence, is not a confirmed root cause or proof that this fork fixes it.

## Monitoring and subscription-level policies

**Insufficient permissions can cause this option to fail, but a previous unspecified monitoring error cannot be attributed to RBAC without the failed operation.** The Multiva profile disables monitoring by explicit customer request, not as a workaround or proof that the failure is fixed.

`Deploy monitoring` configures Log Analytics, diagnostic settings, a data collection rule and the Azure Monitor Agent. The separate **Deploy monitoring policies (subscription level)** option also creates the following:

| Operation | Scope and required permission |
|:--|:--|
| Custom policy definitions | Subscription: `Microsoft.Authorization/policyDefinitions/write` |
| Initiative definition | Subscription: `Microsoft.Authorization/policySetDefinitions/write` |
| Policy assignments | Workload resource groups: `Microsoft.Authorization/policyAssignments/write` |
| Grants for policy managed identities | Affected resource groups: `Microsoft.Authorization/roleAssignments/write` |
| Per-policy remediation tasks | Workload resource groups: `Microsoft.PolicyInsights/remediations/write` |

**Contributor alone is insufficient.** Owner at the required scopes, or an approved least-privilege combination, must cover both policy operations and role-assignment operations. Resource Policy Contributor covers policy management but does not replace the required RBAC role-assignment permissions. Owner only on a resource group does not permit subscription-level definition creation. Activate any required PIM roles before deployment and account for deny assignments and conditions. Turning off policy monitoring does not remove the role-assignment requirements of other baseline features.

Policy remediation uses the **policy assignment's managed identity**, not the deployment user's identity. This source grants Monitoring Contributor and Log Analytics Contributor to those identities at the assignment resource groups. If using a Log Analytics workspace outside those scopes, have the administrator check the identity's effective access at the destination workspace as well. Do not expand permissions automatically.

To establish the actual cause, collect the subscription/resource group and deployment name or ID, the **failed nested deployment operation's** error code, status message and target resource, and the deployment identity's effective roles/scopes at the time of failure. In Portal, open **Deployments > failed deployment > Operation details** and follow failures down to the innermost operation. For a remediation failure, include the policy assignment, its managed-identity principal ID, and the individual remediation error. Do not share credentials or access tokens.

`AuthorizationFailed` or `LinkedAuthorizationFailed` naming one of the actions above is evidence for a permission issue; a generic `DeploymentFailed` is not. A missing initiative `policyDefinitionReferenceId` is a different error. This fork now creates one remediation per initiative child and target resource group, supplying that reference, and explicitly makes AMA wait for the session-host VM even when antimalware is disabled. These are source-level corrections, **not a confirmed diagnosis of the customer's original error**.

When creating a monitoring workspace, the baseline uses the AVD management plane location (East US 2 for Multiva). The DCR follows the new or existing workspace's location. Validate workspace/DCR availability and inspect agent errors separately from policy/RBAC errors.

Official references: [Azure Policy RBAC permissions](https://learn.microsoft.com/azure/governance/policy/overview#azure-rbac-permissions-in-azure-policy) and [remediation identities and permissions](https://learn.microsoft.com/azure/governance/policy/how-to/remediate-resources).

## Domain Join Failure

When encountering a domain join failure in Azure Virtual Desktop, you may receive an error message similar to the following:

"VM has reported a failure when processing extension 'DomainJoin' (publisher 'Microsoft.Compute' and type 'JsonADDomainExtension'). Error message: 'Exception(s) occurred while joining Domain 'email@domain.com''. More information on troubleshooting is available at [https://aka.ms/vmextensionwindowstroubleshoot](https://aka.ms/vmextensionwindowstroubleshoot). (Code: VMExtensionProvisioningError)."

Follow the steps below to troubleshoot and resolve the issue:

### Validate environment and account configuration

- **Check Configuration**: Review your Azure Virtual Desktop (AVD) virtual network configuration and ensure that DNS is properly configured and the virtual network is peered to the network Hub or Identity Services virtual network. When using AD DS or Microsoft Entra Domain Services commonly the virtual network will need to be setup with custom DNS servers settings that point to the domain controllers IPs.
    - Resources:
        - [Name resolution for resources in Azure virtual networks](https://learn.microsoft.com/en-us/azure/virtual-network/virtual-networks-name-resolution-for-vms-and-role-instances?tabs=redhat)

- **Credentials**: Verify that the domain join account credentials (username and password) provided in your AVD LZA configuration are accurate and have the necessary permissions to join devices to the domain. After deployment the credentials used by the automation are aved in the workload key vault.
    - Key vault naming: Key vault naming: *kv-sec-<'DeploymentPrefix'>-<'Environment(test/dev/prod)'>-<'Location'>-<'UniqueString(2)'>*
    - Domain user name secret: *domainJoinUserName*
    - Dmain user password secret: *domainJoinUserPassword*

### Verify DNS and Network Connectivity

- **DNS Resolution**: Ensure that DNS resolution of the domain name is functioning correctly. Run an nslookup/Resolve-DnsName to the FQDN (Fully Qualified Domain Name) of your domain (i.e.: contoso.com) from the deployed temporary management VM or session hosts. If the name is not resolved, it indicates a DNS resolution problem.
    - Resources:
        - [nslookup](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/nslookup)
        - [Resolve-DnsName](https://learn.microsoft.com/en-us/powershell/module/dnsclient/resolve-dnsname?view=windowsserver2022-ps)

- **Domain controller connectivity**: ensure that the AVD session hosts have line of sight to domain controllers. Ping the domain controller from the session host to verify line of sight and use dcdiag for further analysis on the state of the domain controllers. 
    - Resources:
        - [ping](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/ping)
        - [dcdiag](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/dcdiag)
        

### Check Domain Join Account

- **Account Lockout**: Verify that the domain join account is not locked due to multiple failed attempts. Unlock the account if necessary.

- **Password Expiry**: Ensure that the password for the domain joiner account has not expired. Reset the password if needed, and update it in your AVD configuration.

- **Multi Factor Authentication (MFA)**: The account used for the deployment and the Active Directory Domain Join account cannot have multi-factor authentication (MFA) enabled.

- **UPN Mismatch**: Confirm that the User Principal Name (UPN) of the domain joiner account matches the expected format (mail@domain.com)

For further domain join troubleshooting, refer to [Active Directory domain join troubleshooting guidance](https://learn.microsoft.com/en-us/troubleshoot/windows-server/identity/active-directory-domain-join-troubleshooting-guidance).

## FSLogix Issues

After successful deployment and enabling FSLogix, if users' containers are not being created or mounted, follow these steps for troubleshooting:

### Validate configuration
- **Validate storage account configuration**: Review the storage account file share domain join status. If it appears as "Not Configured". If "Not Configured" first ensure domain join on the management virtual machine was successful as this is evidence that the domain join did not fail for usual reasons.
- **Validate FSLogix domain join deployment**: FSLogix settings on the storage account are delivered by an Azure deployment on the service objects resource group (rg-avd-<DeploymentPrefix>-<Environment>-<Region>-service-objects) with name Add-fslogix-Storage-Setup-<TimeStamp> and a DSC PowerShell script that the deployment runs in the management VM using an extension. To Troubleshoot this items follow:
    - Deployment: make sure the deployment was successful and that the management VM has an extension named AzureFilesDomainJoin, if the deployment faile or the extension is not present a redeployment will be needed.
    - DSC script: a failure of this script is the most common reson for FSLogix setup issues. To check if the script ran properly or get additional insights analyze the log file at C:\Windows\temp\ManualDscStorageScriptsLog.log
- **If using private endpoints**: Ensure you are able to resolve to the created file share in the storage account from the management virtual machine. If unable to resolve, ensure DNS is correctly set up, including:
    - Verify that Private DNS Zones are correctly configured to the Identity Services virtual network.
    - If using custom DNS, conditional forwarders should be configured. Verify this is correctly configured.

Other known issues:

## Storage account domain join

When attempting to join an [Azure Storage account to a domain](https://learn.microsoft.com/en-us/azure/storage/files/storage-files-identity-ad-ds-enable), whether it's Microsoft Entra Domain Services or an on-premises Active Directory, several common issues can arise. Here are some of the most common problems:

| Issue  |  Description |
| ------------ | ------------ |
| Network Connectivity Issues [Diagnose connectivity problems](https://learn.microsoft.com/en-us/azure/private-link/troubleshoot-private-endpoint-connectivity)  |  Lack of network connectivity between the Azure virtual network (where the storage account resides) and the domain controller, which can be on-premises or in another Azure virtual network. |
|  DNS Resolution Problems | Incorrect DNS settings or DNS server misconfiguration in the virtual network, preventing proper resolution of domain controller names.  |
| Firewall or Network Security Group (NSG) Rules [NSG filter network traffic](https://learn.microsoft.com/en-us/azure/virtual-network/network-security-group-how-it-works)  | Inadequate firewall or NSG rules that block the necessary traffic between the storage account and the domain controller.  |
| Private Endpoint Configuration [Connect to a storage account using an Azure Private Endpoint](https://learn.microsoft.com/en-us/azure/private-link/tutorial-private-endpoint-storage-portal?tabs=dynamic-ip)  |Misconfiguration of the private endpoint for Azure Storage, such as associating it with the wrong subnet or not properly linking it to the storage account   |
|Credentials and Permissions   | Insufficient permissions or incorrect credentials provided when attempting to join the storage account to the domain  |
|  Domain Controller Health | Domain controller issues, such as being offline, unresponsive, or incorrectly configured, can prevent successful domain join operations  |
| DNS Zone Configuration  | Errors in configuring the private DNS zone, which is necessary for resolving domain controller names through the private endpoint  |
|Domain Trust Relationship   |  Problems with the trust relationship between the Azure virtual network and the domain, including issues with trust setup, trust validation, or secure channel communications |
|Security and Compliance Requirements   |Security policies, compliance requirements, or organizational restrictions may prevent the successful domain join of the storage account   |
|Resource Locks and Resource Policies | Resource locks or resource policies applied to the storage account may interfere with domain join operations if not configured correctly  |


## Group policy (GPO) could affect LZA

Active Directory Group Policies (GPOs) can significantly impact the deployment of AVD LZA, which is designed to simplify and accelerate the setup of an AVD environment.

|Topic   | Issue  | Solution  |
| ------------ | ------------ | ------------ |
| Network and Firewall Policies  |   GPOs might enforce restrictive network or firewall policies on AVD virtual desktops, preventing them from connecting to Azure services or the required AVD components. | Review and adjust firewall rules in GPOs to permit necessary traffic for AVD. Create specific GPOs or OU (Organizational Unit) structures for AVD virtual desktops with the appropriate rules.  |
|Proxy Settings   | GPOs enforcing proxy settings can hinder AVD virtual desktops' ability to connect to Azure services and resources through the proxy.  | Configure GPO exceptions for Azure and AVD-related endpoints. Consider creating a separate GPO for AVD virtual desktops without proxy settings if necessary.  |
|Security Policies   |  Overly strict GPO security policies can conflict with AVD Accelerator's recommended security configurations. | Review and adjust GPO security policies to align with AVD security requirements. Ensure that AVD-specific security recommendations are considered in your GPOs.  |
|  DNS Configuration | GPOs may enforce DNS settings that are incompatible with Azure DNS and AVD requirements.  |  Ensure that DNS configurations in GPOs align with Azure DNS requirements and that DNS servers can resolve Azure and AVD-related hostnames. |
| Organizational Unit (OU) Structure  |  Inappropriate placement of AVD virtual desktops in AD OUs with conflicting GPOs can lead to issues.  | Design an OU structure that isolates AVD virtual desktops or OU-link specific GPOs to the OUs where AVD desktops reside. Test GPO inheritance to ensure desired settings apply.   |
