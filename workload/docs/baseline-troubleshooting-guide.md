# Troubleshooting Guide: Azure Virtual Desktop Landing Zone Accelerator

## Portal validation: Cannot read properties of undefined (reading 'location')

If the error is a `TypeError` in the `Microsoft_Azure_CreateUIDef` extension with `getFormTemplateDeploymentOptions` in its stack, it occurs during the Portal's form-to-deployment conversion, before ARM validation. It is not evidence of a monitoring-policy permission failure.

For a subscription deployment, Portal's `view.outputs.subscriptionId` must be a subscription **ARM ID**, `/subscriptions/<subscription-id>`, not the bare GUID. The reported converter parses that ID to build its deployment scope; an invalid scope can leave that object undefined before its `location` is read. This fork constructs the ARM ID from the selected subscription GUID for the deployment output. The template parameter `avdWorkloadSubsId` and resource/API picker scopes still use the GUID, as required.

Close an older deployment tab and reopen the newly published form; existing tabs or commit-pinned links keep the older output expression. Select the subscription and shared deployment/management region, then run **Review + create** again. Publication and offline contract checks do not constitute a successful live Portal validation or customer deployment. If the error persists with the new version, collect the full error JSON and form version without sharing credentials or access tokens.

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
