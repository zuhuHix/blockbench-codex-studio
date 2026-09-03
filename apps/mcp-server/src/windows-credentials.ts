import { execFile } from "node:child_process";

const credentialTarget = "BlockbenchCodexStudio:OpenAI";

function encodedPowerShell(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64");
}

/**
 * Reads the generic Credential Manager entry without ever placing its secret
 * in an argument, log message, project file, or error. The child stdout is
 * consumed only by the provider request that needs it.
 */
export async function readWindowsOpenAiCredential(): Promise<
  string | undefined
> {
  if (process.platform !== "win32") return undefined;
  const script = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class BcCredentialReader {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  private struct CREDENTIAL {
    public UInt32 Flags; public UInt32 Type; public IntPtr TargetName;
    public IntPtr Comment; public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public UInt32 CredentialBlobSize; public IntPtr CredentialBlob;
    public UInt32 Persist; public UInt32 AttributeCount; public IntPtr Attributes;
    public IntPtr TargetAlias; public IntPtr UserName;
  }
  [DllImport("advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)]
  private static extern bool CredRead(string target, UInt32 type, UInt32 flags, out IntPtr credential);
  [DllImport("advapi32.dll", SetLastError=true)] private static extern void CredFree(IntPtr credential);
  public static string Read(string target) {
    IntPtr pointer;
    if (!CredRead(target, 1, 0, out pointer)) return "";
    try {
      CREDENTIAL value = (CREDENTIAL)Marshal.PtrToStructure(pointer, typeof(CREDENTIAL));
      return value.CredentialBlobSize == 0 ? "" : Marshal.PtrToStringUni(value.CredentialBlob, (int)value.CredentialBlobSize / 2);
    } finally { CredFree(pointer); }
  }
}
'@
[Console]::Out.Write([BcCredentialReader]::Read('${credentialTarget}'))
`;
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        encodedPowerShell(script),
      ],
      { encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 },
      (error, stdout) => {
        const value = error === null ? stdout.trim() : "";
        resolve(value === "" ? undefined : value);
      },
    );
  });
}
