# Azure Virtual Desktop LZA - Baseline - Deployment walk through

## Multiva defaults

The commercial baseline in this fork is the Multiva-specific version of the upstream accelerator. Use its **Deploy to Azure** button, which loads both `workload/arm/deploy-baseline.json` and `workload/portal-ui/portal-ui-baseline.json` from `gracielars999/avdaccelerator`. Opening only the template in the generic custom-template editor bypasses the custom form and its availability-zone output normalization.

| Setting | Default |
|:--|:--|
| Deployment record and AVD service objects / management plane | One editable region on Basics; select East US 2 (`eastus2`) for Multiva |
| Session hosts and workload network | Mexico Central (`mexicocentral`) |
| Host pool | Personal, automatic assignment |
| Image | Marketplace, `MicrosoftWindowsDesktop/windows-11/win11-24h2-avd`, latest image version |
| OS disk | Premium |
| Availability | Availability Zones, with logical zones 1 and 2 selected; literal template choices are 1, 2 and 3 |
| FSLogix | Disabled |
| Virtual network | New, `10.131.0.0/16` |
| AVD subnet | `10.131.17.0/24` |
| Private endpoint subnet | `10.131.16.0/24` |
| AVD private endpoints | Enabled |
| Private DNS zones | Create new |
| Monitoring | Disabled by explicit customer request |

The existing VM size (`Standard_D4ads_v5`), VM count (**1**), and other unrelated source defaults are unchanged. The Portal size selector retains that size as its first recommendation; select a size available in the customer's subscription. Selecting two zones does not create two VMs: increase the VM count to at least two to place hosts in both zones. Hosts are distributed round-robin across the selected zones; selecting one zone remains supported.

East US 2 is **not** the VM location. Under AVD's default geographical deployment scope, these settings associate AVD metadata with the **US geography**, outside Mexico; they do not guarantee metadata storage exclusively in East US 2. Review [AVD data locations](https://learn.microsoft.com/azure/virtual-desktop/data-locations) and customer residency requirements before deploying. [Mexico Central supports availability zones](https://learn.microsoft.com/azure/reliability/regions-list), but the selected subscription's SKU/image availability, quota and capacity must still be checked.

The Marketplace SKU filter now matches the original accelerator exactly: it includes Windows AVD images and excludes SKU names containing `ent`. The default is therefore **`win11-24h2-avd`**, Windows 11 Enterprise 24H2 **multi-session**, replacing the previous single-session `win11-24h2-ent` choice. The host pool remains **Personal**; assignment type and OS edition are separate settings. Windows-11, the release, FSLogix and monitoring preferences remain unchanged.

Changing an image default does not reimage an existing session host or repair its Entra join. Do not retry an existing VM with a different Marketplace SKU as an in-place image change; plan new hosts separately before modifying customer resources.

The Availability Option remains selectable independently of VM size discovery. The zone dropdown now contains a **literal** list of template-supported logical IDs **1, 2 and 3**, with **1 and 2** selected for Multiva. It has no region/API expression or zone lookup that can leave its item list empty. This is manual deployment intent, **not automatic availability discovery**: a visible warning and required checkbox still require verifying the selected region, VM size and subscription restrictions. When selecting another VM region, verify that it offers the chosen zones; explicitly choose regional deployment if it does not. The form does not silently change to regional VMs, and these identifiers do not guarantee image/SKU availability, subscription eligibility, quota or capacity.

If you open the standard ARM **Edit parameters** screen, retain `availabilityZones` as a collection and use plain zone IDs in its controls; do not enter a `createArray(...)` expression or add quote characters to individual entries. In a **JSON parameter file**, the value must be an actual array: `["2"]` for one zone or `["1", "2"]` for two, never `2` or `"2"`. This entrypoint intentionally has no top-level `allowedValues` on that array, which made the generic editor offer a scalar dropdown and warn that the array default was not allowed. The same allowed string IDs are enforced by the nested session-host template instead. For regional VMs, set `availability` to `None` and `availabilityZones` to `[]`.

The custom form converts selected numeric zone IDs to strings without JSON-quoting an existing string again. CreateUiDefinition's `string()` conversion is not ARM's `string()` conversion: applying it directly to the string `1` produces a value containing extra quotes. The baseline also decodes one JSON string layer on individual array entries before passing them to the session-host module, covering the quoted values reported after parameter edits. The parameter stays array-typed, only IDs `1`, `2` and `3` remain allowed, and malformed or unknown IDs still fail validation.

For example, after signing into the **customer's** subscription, this read-only command follows SKU-list pagination and includes subscription restrictions:

```powershell
az vm list-skus --subscription "<customer-subscription-id>" --location mexicocentral --size Standard_D4ads_v5 --resource-type virtualMachines --all --query "[?name=='Standard_D4ads_v5'].{name:name,locationInfo:locationInfo,restrictions:restrictions}" --output json
```

Check `locationInfo` for `mexicocentral`, its `zones`, and any location/zone `restrictions`. No matching SKU, a zone not listed for that size, or a subscription restriction is not resolved by selecting the zone in this form; choose an eligible size or resolve the restriction first. The command is not a deployment, and listed eligibility is still not a capacity guarantee.

Select the customer's subscription in **Basics** and supply the deployment prefix, identity/domain information, access groups, and credentials. No customer credentials, subscription ID, or tenant-specific enterprise-application object ID is preconfigured. For Start VM on Connect or scaling, use the existing picker to select the **Azure Virtual Desktop** enterprise application in the customer's tenant. Application ID `9cdead84-a844-4324-93f2-b2e6bb768d07` identifies the application, but its service-principal **object ID varies by tenant** and cannot be substituted with the application ID.

In **Identity provider > Session host local admin credentials**, enter **Username** and the password. This uses the original accelerator's required `Microsoft.Common.TextBox` for the username, separately from its Windows password control, and exports the text directly as `avdVmLocalUserName`. The `localadmin` placeholder is an example, not a preconfigured account. Both credentials are required and non-empty, including for Microsoft Entra ID-joined VMs; an Entra sign-in does not replace the local account required to provision Windows. The username is written to the workload Key Vault and used for the VM's `osProfile.adminUsername`. No username or password default is supplied. When redeploying an existing VM, use its original administrator username and re-enter required secure inputs if the Portal does not retain their Key Vault references; do not share passwords or commit them to parameter files.

The baseline now explicitly passes `[]` to the internal VM template's optional **Data Disks** input, meaning no data disks; it does not add a disk. This field is not a top-level baseline parameter. If editing a nested VM redeployment for a VM with no data disks, enter `[]` in its array editor rather than leaving it blank. Preserve any intentional existing disk definitions instead of clearing them. Use the updated accelerator entrypoint for a full baseline deployment; an older deployment's **Redeploy** action retains its stored template. See [redeployment troubleshooting](./baseline-troubleshooting-guide.md).

For command-line use, both `.bicepparam` samples read `AVD_VM_LOCAL_USERNAME` and `AVD_VM_LOCAL_PASSWORD` from the current process environment without a fallback. Supply those inputs privately before compiling or deploying the sample; missing or blank inputs are not valid credentials. Compilation can write the password into the generated JSON parameter file, so keep that file private and never commit or share it. The Portal form continues to use its required admin fields and does not read these environment variables.

The Basics step has **one editable Deployment and AVD management plane region** picker. Select **East US 2** for Multiva: that selection drives both the subscription deployment record and AVD service objects. The separate **Session hosts region** remains Mexico Central by default. The Bicep/ARM management-plane default is still `eastus2`; the native Portal picker is editable and requires selecting the intended region rather than relying on an undocumented picker default.

Portal's deployment scope output uses the full subscription ARM ID (`/subscriptions/<subscription-id>`), while API scopes use the subscription GUID. The template's optional `avdWorkloadSubsId` defaults to `subscription().subscriptionId`, so the normal deployment inherits the actual subscription selected in Portal rather than requiring a duplicate ID. The custom form deliberately omits that parameter output, and both parameter samples inherit the same default. An intentional cross-subscription deployment can still override it with the workload subscription **GUID**, not an ARM ID; ensure the deployment identity has the required access at both scopes. Defaults apply only when the parameter is omitted: remove an old empty override or replace it with the intended GUID. An explicit blank is rejected instead of silently choosing another subscription. See [validation troubleshooting](./baseline-troubleshooting-guide.md).

Register the required providers and verify private-link routing and DNS as described in [Getting Started](./getting-started-baseline.md). The host pool retains the form's private-link default `EnabledForClientsOnly`; review the client/session-host access settings rather than assuming all AVD traffic is private. New DNS zones must be reachable through the customer's DNS design, especially with AD DS and custom DNS servers.

**The hosted button is not updated by local edits.** After review and authorization, publish the source, generated ARM, form, and documentation together to this fork's `main`, then use the button. Before publication, only the local worktree contains these changes. No successful customer deployment is implied.

| Portal UI Experience (ARM) |
| ------------------------------------------------------------ |
| [![Deploy To Azure](https://aka.ms/deploytoazurebutton)](https://portal.azure.com/#blade/Microsoft_Azure_CreateUIDef/CustomDeploymentBlade/uri/https%3A%2F%2Fraw.githubusercontent.com%2Fgracielars999%2Favdaccelerator%2Fmain%2Fworkload%2Farm%2Fdeploy-baseline.json/uiFormDefinitionUri/https%3A%2F%2Fraw.githubusercontent.com%2Fgracielars999%2Favdaccelerator%2Fmain%2Fworkload%2Fportal-ui%2Fportal-ui-baseline.json) [![Deploy to Azure Gov](https://aka.ms/deploytoazuregovbutton)](https://portal.azure.us/?feature.deployapiver=2022-12-01#blade/Microsoft_Azure_CreateUIDef/CustomDeploymentBlade/uri/https%3A%2F%2Fraw.githubusercontent.com%2FAzure%2Favdaccelerator%2Fmain%2Fworkload%2Farm%2Fdeploy-baseline.json/uiFormDefinitionUri/https%3A%2F%2Fraw.githubusercontent.com%2FAzure%2Favdaccelerator%2Fmain%2Fworkload%2Fportal-ui%2Fportal-ui-baseline.json) [![Deploy to Azure China](https://aka.ms/deploytoazurechinabutton)](https://portal.azure.cn/?feature.deployapiver=2022-12-01#blade/Microsoft_Azure_CreateUIDef/CustomDeploymentBlade/uri/https%3A%2F%2Fraw.githubusercontent.com%2FAzure%2Favdaccelerator%2Fmain%2Fworkload%2Farm%2Fdeploy-baseline.json/uiFormDefinitionUri/https%3A%2F%2Fraw.githubusercontent.com%2FAzure%2Favdaccelerator%2Fmain%2Fworkload%2Fportal-ui%2Fportal-ui-baseline.json)|

- **Basics** blade
  - **Subscription** - The subscription where the accelerator is going to deploy the resources.
  - **Deployment and AVD management plane region** – One editable selection sets both locations. Select East US 2 for Multiva; the session host location is selected separately.
  - **Prefix** – A prefix of maximum 4 characters that will be appended to the names of Resource Groups and Azure resources within the Resource Groups.
  - **Environment** – Deployment Environment type (Development/Test/Production), will be used for naming and tagging purposes.
- **Identity provider** blade
  - **Domain to join**
    - **Identity Service Provider** - Identity service provider (AD DS, Entra DS, Microsoft Entra ID) that already exists and will be used for Azure Virtual Desktop.
      - Active Directory (AD DS).
      - Microsoft Entra Domain Services.
      - Microsoft Entra ID
      - Microsoft Entra ID Kerberos
      - **Domain name** - The full qualified domain name of the on-premises domain where the hybrid identities originated from. This requirement also applies to Microsoft Entra ID Kerberos + FSLogix deployments.
      - **Domain GUID** - GUID for the on-premises domain controller when Microsoft Entra ID Kerberos is selected..
    - **Azure Virtual Desktop access assignment** - These identities will be granted access to Azure Virtual Desktop application groups (role "Desktop Virtualization User").
    - Groups - select from the fly-out group selector the group to be granted access to Azure Virtual Desktop published items and to create sessions on VMs and single sign-on (SSO) when using Microsoft Entra ID as the identity provider.
    - Note: when using Microsoft Entra ID as the identity service provider, an additional role (virtual machine user login) will be granted to compute resource group during deployment.
  - **When selecting AD DS or Microsoft Entra DS:**
    - Domain join credentials: The Username and password with rights to join computers to the domain.
  - **When selecting Microsoft Entra ID:**
    - Enroll VM with Intune: Check the box to enroll session hosts on the tenant’s Intune.
  - **Session host local admin credentials** **Username** and password are required, including with Microsoft Entra ID. These are local Windows credentials, not the domain join account or Entra user principal name.
  - **Microsoft Defender for Cloud Solutions**:
    - This section enables advanced security monitoring for resources deployed within your Azure Virtual Desktop setup. Below are the Defender solutions available:
      - **Deploy Microsoft Defender for Cloud**: Deploys a policy for enabling overall security monitoring for the platform and resources deployed as part of Azure Virtual Desktop.
      - **Enable Microsoft Defender for Servers**: Deploys a policy for providing enhanced protection for session host virtual machines (VMs), including real-time threat detection, vulnerability assessment, and automated response.
      - **Enable Microsoft Defender for Storage**: Deploys a policy for protecting Azure Storage resources (e.g., FSLogix file shares) against malicious threats and unauthorized access attempts.
      - **Enable Microsoft Defender for Key Vault**: Deploys a policy to monitor Azure Key Vault access and prevent misuse or unauthorized activity.
      - **Enable Microsoft Defender for Azure Resource Manager**: Deploys a policy for ensuring the integrity of management operations on Azure resources by monitoring for suspicious activity or privilege escalations.
    - **Recommendation**:
      - Enable relevant Defender solutions for better security posture in production environments. For cost estimation, refer to the [Azure Pricing Calculator](https://azure.microsoft.com/en-us/pricing/calculator/).
- **Management plane** blade
  - **Deployment location** - Uses the management plane region selected on the Basics step. Supported service-object locations differ from session host VM locations; see [AVD data locations](https://learn.microsoft.com/azure/virtual-desktop/data-locations) for the metadata deployment scope.
  - **Host pool type** - Personal assigns each session host to one user; Pooled shares host capacity. This setting does not change the original accelerator's Marketplace SKU filter or the selected OS edition.
  - When Pooled is selected:
    - **Load balancing algorithm** - Choose either breadth-first or depth-first, based on your usage pattern. Learn more about what each of these options means at [Host pool load-balancing methods](https://docs.microsoft.com/azure/virtual-desktop/host-pool-load-balancing).
    - **Max session limit** - Enter the maximum number of users you want load-balanced to a single session host.
    - **Create remote app group** - Choose if you want to create a RemoteApp application group or not. A Desktop application group will be created by default.
    - **Scaling plan** - Choose if you want to create a scaling plan or not. An Azure Virtual Desktop scaling plan will be created and host pools assigned to it.
  - When Personal is selected:
    - **Machine assignment** - Select either Automatic or Direct.
    - **Start VM on connect** - Choose if you want the host pool to be configured to allow users starting session hosts on demand.
- **Session hosts** blade
  - **Deploy sessions hosts** - You can choose to not deploy session hosts just the Azure Virtual Desktop service objects.
  - **Session host region** - Defaults to Mexico Central, independently of the management plane region.
  - **Session hosts OU path (Optional)** - Provide OU where to locate session hosts, if not provided session hosts will be placed on the default (computers) OU. If left empty the computer account will be created in the default Computers OU. Example: OU=avd,DC=contoso,DC=com.
  - **Availability zones** - Choose Availability Zones and select one or more logical IDs from the template's literal multi-select list. The Multiva selection is zones 1 and 2. Verify the selected region, VM size and subscription restrictions for those zones and acknowledge the verification checkbox. The form always outputs an array of string zone identifiers, including for a single selection. Choose "No infrastructure redundancy required" explicitly for regional VMs; this is independent of the storage redundancy selection.
  - **VM size** -  Select the SKU size for the session hosts.
  - **VM count** - Select the number of session hosts to deploy.
  - **OS disk type** - Select the OS Disk SKU type. Premium is recommended for performance and a higher SLA.
  - **Zero trust disk configuration** - Check the box to enable the zero trust configuration on the session host disks to ensure all the disks are encrypted, the OS and data disks are protected with double encryption with a customer managed key, and network access is disabled.
  - **Enable Antimalware extension** -  Enables Azure VM antimalware extension on session hosts
  - **Enable accelerated networking** - Check the box to ensure the network traffic on the session hosts is offloaded to the network interface to enhance performance. This feature is free and available as long a supported VM SKU and [OS](https://learn.microsoft.com/en-us/azure/virtual-network/accelerated-networking-overview?tabs=redhat#supported-operating-systems) is chosen. To check whether a VM size supports Accelerated Networking, see [Sizes for virtual machines in Azure](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes). This feature is recommended as it will decrease CPU utilization for networking (offloading to NIC) and increase network performance/throughput to Azure VMs and Services, like Azure Files.
  - **OS image source** - Select a marketplace image or an image from Azure Compute Gallery (Custom image build deployment will create images in compute gallery).
  - **OS version or image** - Choose the OS version or desired image from the Azure compute gallery.
- **Storage** blade
  - **General Settings**:
    - **Custom OU Path (Optional)**: specify an OU path to create domain storage objects.
    - **Zone redundant storage**: Select to replicate storage across availability zones or only use local redundancy.
  - **FSLogix profile management**: Deploys FSLogix containers and session host setup for user's profiles.
  - **FSLogix Azure Files share Performance** - Select the desired performance.
  - **FSLogix file share size** Choose the desired size in 100GB increments. Minimum size is 100GB.
  - **App Attach**: Deploys App Attach container for App Attach app packages.
  - **App Attach Azure Files share Performance** - Select the desired performance.
  - **App Attach file share size** Choose the desired size in 100GB increments. Minimum size is 100GB.
- **Network connectivity** blade
  - **Virtual Network** - Select if creating "New"" or use "Existing" virtual network.
    - **New** - Select if you want to create a new VNet to be used for Azure Virtual Desktop.
      - **vNet address range** - Enter the IP block in CIDR notation to allocate to the VNet.
      - **Azure Virtual Desktop subnet address prefix** - Enter IP block in CIDR notation for the new Azure Virtual Desktop subnet.
      - **Private endpoint subnet address prefix** - Enter IP block in CIDR notation for the new private endpoint subnet.
      - **Custom DNS servers** - Enter the custom DNS servers IPs to be set on the VNet. These DNS server should have proper DNS resolution to your AD DS domain, internet and Azure private DNS zones for private endpoint resolution.
    - **Existing** - Select if using existing virtual networks for the Azure Virtual Desktop deployment.
      - **Azure Virtual Desktop virtual network** - Select virtual network to be used for Azure Virtual Desktop deployment.
      - **Azure Virtual Desktop subnet** - Select virtual network subnet to be used for session hosts deployment. This subnet must have a service endpoint for Microsoft.Storage.
      - **Private endpoint virtual network** - Select virtual network to be used for private endpoint deployment.
      - **Private endpoint subnet** - Select virtual network subnet to be used for private endpoint deployment.
  - **Private endpoints (Key vault and Azure files)** - Select the checkbox to create private endpoints for key vault and Azure file services, when selecting no public endpoints of the services will be used.
  - **Azure private DNS zones** - Defaults to **Create new** for the enabled private endpoints. Choose **Use existing** to select existing zones instead. The default does not require existing zone IDs; verify DNS resolution and virtual network links for the customer's network design.
  - **Existing hub VNet peering**
    - **Virtual Network** - Select the hub VNet where this new VNet will be peered with.
    - **VNet Gateway on hub** - Select the checkbox to set the use remote gateway option for the VNet peering.
- **Monitoring** blade
  - **Deploy monitoring** - select checkbox to deploy all required diagnostic configurations all Azure Virtual Desktop resources, also events and performance stats will be pushed from session hosts to a log analytics workspace.
    - **Log analytics workspace** - select if creating a new workspace or if using and existing one.
    - **Deploy monitoring policies (subscription level)** - creates custom policy and initiative definitions at subscription scope, then assignments and per-policy remediations in the workload resource groups. Contributor alone is insufficient; see [monitoring permissions and troubleshooting](./baseline-troubleshooting-guide.md#monitoring-and-subscription-level-policies). Disabling monitoring is the requested Multiva default, not a diagnosis or fix for a previous failure.
- **Resource naming** blade
  - **Custom Resource Naming** - select the checkbox to provide the names that will be used to name resources. When the checkbox is not selected deployment will use the Azure Virtual Desktop accelerator naming standard.
- **Resource tagging** blade
  - **Custom Resource tagging** - select the checkbox to provide information to be use to create tags on resources and resource groups.
- **Review + create** blade

Take a look at the [Naming Standard and Tagging](./resource-naming.md) page for further information.

## Post Deployment Considerations

- When using Microsoft Entra ID Kerberos as identity provider and deploying FSLogix storage, it is required to grant admin consent to the storage account service principal (your-storage-account-name.file.core.windows.net) created during deployment, additional information can be found in the
[Grant admin consent to the new service principal](https://learn.microsoft.com/azure/storage/files/storage-files-identity-auth-hybrid-identities-enable?tabs=azure-portal#grant-admin-consent-to-the-new-service-principal) guide.

## Redeployment Considerations

When redeploying the baseline automation with the same deployment prefix value, clean up of previously created resource groups or at least their contained resources will need to be removed before the new deployment is executed, this will prevent the duplication of resources (key vaults and storage accounts) and conflicts of IP range overlap when creating the Azure Virtual Desktop virtual network.

## Other Deployment Options

We have these other options available:

| Deployment Type | Link |
|:--|:--|
| Azure portal UI |[![Deploy to Azure](https://aka.ms/deploytoazurebutton)](https://portal.azure.com/#blade/Microsoft_Azure_CreateUIDef/CustomDeploymentBlade/uri/https%3A%2F%2Fraw.githubusercontent.com%2Fgracielars999%2Favdaccelerator%2Fmain%2Fworkload%2Farm%2Fdeploy-baseline.json/uiFormDefinitionUri/https%3A%2F%2Fraw.githubusercontent.com%2Fgracielars999%2Favdaccelerator%2Fmain%2Fworkload%2Fportal-ui%2Fportal-ui-baseline.json) [![Deploy to Azure Gov](https://aka.ms/deploytoazuregovbutton)](https://portal.azure.us/#blade/Microsoft_Azure_CreateUIDef/CustomDeploymentBlade/uri/https%3A%2F%2Fraw.githubusercontent.com%2FAzure%2Favdaccelerator%2Fmain%2Fworkload%2Farm%2Fdeploy-baseline.json/uiFormDefinitionUri/https%3A%2F%2Fraw.githubusercontent.com%2FAzure%2Favdaccelerator%2Fmain%2Fworkload%2Fportal-ui%2Fportal-ui-baseline.json) [![Deploy to Azure China](https://aka.ms/deploytoazurechinabutton)](https://portal.azure.cn/#blade/Microsoft_Azure_CreateUIDef/CustomDeploymentBlade/uri/https%3A%2F%2Fraw.githubusercontent.com%2FAzure%2Favdaccelerator%2Fmain%2Fworkload%2Farm%2Fdeploy-baseline.json/uiFormDefinitionUri/https%3A%2F%2Fraw.githubusercontent.com%2FAzure%2Favdaccelerator%2Fmain%2Fworkload%2Fportal-ui%2Fportal-ui-baseline.json)|
| Command line (Bicep/ARM) | [![Powershell/Azure CLI](./icons/powershell.png)](../bicep/readme.md#avd-accelerator-baseline) |
| Terraform | [![Terraform](./icons/terraform.png)](../terraform/greenfield/readme.md) |

## Next Steps

- After successful deployment, you can remove the following temporary resources used only during deployment:
  - Management virtual machine (`vmmgmt{deploymentPrefix}{DeploymentEnvironment-d/t/p}{AzureRegionAcronym}`) and its associated OS disk and network interface.
- You should assign specific roles, including [Azure Virtual Desktop - Specific roles](https://learn.microsoft.com/en-us/azure/virtual-desktop/rbac) based on your organization’s policies.
- Preferably enable NSG Flow logs and Traffic Analytics.

## Known Issues

Please report issues using the project's [issues](https://github.com/Azure/avdaccelerator/issues) tracker.
