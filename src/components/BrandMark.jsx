import logo from "../assets/logo.png";

export function BrandMark({ size = 20 }) {
  return (
    <img
      src={logo}
      alt="Paik Butler Logo"
      width={size}
      height={size}
      style={{ objectFit: "contain" }}
    />
  );
}

