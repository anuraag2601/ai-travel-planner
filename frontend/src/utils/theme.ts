import { createTheme } from '@mui/material/styles'
import { alpha } from '@mui/material/styles'

// Custom color palette
const palette = {
  primary: {
    main: '#1976d2',
    light: '#42a5f5',
    dark: '#1565c0',
    contrastText: '#ffffff',
  },
  secondary: {
    main: '#ff6b35',
    light: '#ff9a67',
    dark: '#c73e00',
    contrastText: '#ffffff',
  },
  success: {
    main: '#4caf50',
    light: '#81c784',
    dark: '#388e3c',
  },
  warning: {
    main: '#ff9800',
    light: '#ffb74d',
    dark: '#f57c00',
  },
  error: {
    main: '#f44336',
    light: '#e57373',
    dark: '#d32f2f',
  },
  grey: {
    50: '#fafafa',
    100: '#f5f5f5',
    200: '#eeeeee',
    300: '#e0e0e0',
    400: '#bdbdbd',
    500: '#9e9e9e',
    600: '#757575',
    700: '#616161',
    800: '#424242',
    900: '#212121',
  },
  background: {
    default: '#fafafa',
    paper: '#ffffff',
  },
}

// Custom typography
const typography = {
  fontFamily: [
    'Inter',
    '-apple-system',
    'BlinkMacSystemFont',
    '"Segoe UI"',
    'Roboto',
    '"Helvetica Neue"',
    'Arial',
    'sans-serif',
  ].join(','),
  h1: {
    fontSize: '2.5rem',
    fontWeight: 600,
    lineHeight: 1.2,
  },
  h2: {
    fontSize: '2rem',
    fontWeight: 600,
    lineHeight: 1.3,
  },
  h3: {
    fontSize: '1.75rem',
    fontWeight: 600,
    lineHeight: 1.3,
  },
  h4: {
    fontSize: '1.5rem',
    fontWeight: 600,
    lineHeight: 1.4,
  },
  h5: {
    fontSize: '1.25rem',
    fontWeight: 600,
    lineHeight: 1.4,
  },
  h6: {
    fontSize: '1.125rem',
    fontWeight: 600,
    lineHeight: 1.4,
  },
  body1: {
    fontSize: '1rem',
    lineHeight: 1.5,
  },
  body2: {
    fontSize: '0.875rem',
    lineHeight: 1.5,
  },
  button: {
    fontSize: '0.875rem',
    fontWeight: 600,
    textTransform: 'none' as const,
  },
  caption: {
    fontSize: '0.75rem',
    lineHeight: 1.4,
  },
}

// Create theme
export const theme = createTheme({
  palette,
  typography,
  shape: {
    borderRadius: 8,
  },
  spacing: 8,
  components: {
    // Button customizations
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          padding: '10px 24px',
          fontSize: '0.875rem',
          fontWeight: 600,
          textTransform: 'none',
          boxShadow: 'none',
          '&:hover': {
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
          },
        },
        contained: {
          '&:hover': {
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
          },
        },
        outlined: {
          borderWidth: '2px',
          '&:hover': {
            borderWidth: '2px',
          },
        },
        sizeLarge: {
          padding: '12px 32px',
          fontSize: '1rem',
        },
        sizeSmall: {
          padding: '6px 16px',
          fontSize: '0.75rem',
        },
      },
    },

    // Card customizations
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
          '&:hover': {
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.12)',
          },
        },
      },
    },

    // TextField customizations
    MuiTextField: {
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            borderRadius: 8,
            '&:hover .MuiOutlinedInput-notchedOutline': {
              borderColor: palette.primary.main,
            },
          },
        },
      },
    },

    // Chip customizations
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: 20,
          fontWeight: 500,
        },
      },
    },

    // AppBar customizations
    MuiAppBar: {
      styleOverrides: {
        root: {
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
          backgroundColor: '#ffffff',
          color: palette.grey[800],
        },
      },
    },

    // Drawer customizations
    MuiDrawer: {
      styleOverrides: {
        paper: {
          border: 'none',
          boxShadow: '0 0 20px rgba(0, 0, 0, 0.1)',
        },
      },
    },

    // Dialog customizations
    MuiDialog: {
      styleOverrides: {
        paper: {
          borderRadius: 16,
          boxShadow: '0 10px 40px rgba(0, 0, 0, 0.15)',
        },
      },
    },

    // Paper customizations
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
        },
        elevation1: {
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)',
        },
        elevation2: {
          boxShadow: '0 2px 6px rgba(0, 0, 0, 0.08)',
        },
        elevation3: {
          boxShadow: '0 3px 10px rgba(0, 0, 0, 0.08)',
        },
      },
    },

    // Tab customizations
    MuiTab: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 600,
          fontSize: '0.875rem',
          minHeight: 48,
        },
      },
    },

    // Loading spinner customizations
    MuiCircularProgress: {
      styleOverrides: {
        root: {
          color: palette.primary.main,
        },
      },
    },

    // Backdrop customizations
    MuiBackdrop: {
      styleOverrides: {
        root: {
          backgroundColor: alpha('#000000', 0.7),
        },
      },
    },
  },
})

// Dark theme variant
export const darkTheme = createTheme({
  ...theme,
  palette: {
    ...theme.palette,
    mode: 'dark' as const,
    background: {
      default: '#121212',
      paper: '#1e1e1e',
    },
    text: {
      primary: '#ffffff',
      secondary: alpha('#ffffff', 0.7),
    },
  },
  components: {
    ...theme.components,
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: '#1e1e1e',
          color: '#ffffff',
        },
      },
    },
  },
})

// Theme utilities
export const getTheme = (mode: 'light' | 'dark') => {
  return mode === 'dark' ? darkTheme : theme
}

// Common styles
export const commonStyles = {
  // Flex utilities
  flexCenter: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  flexBetween: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  flexColumn: {
    display: 'flex',
    flexDirection: 'column' as const,
  },
  
  // Typography utilities
  textTruncate: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  textCenter: {
    textAlign: 'center' as const,
  },
  
  // Layout utilities
  fullWidth: {
    width: '100%',
  },
  fullHeight: {
    height: '100%',
  },
  
  // Animation utilities
  fadeIn: {
    animation: 'fadeIn 0.3s ease-in-out',
    '@keyframes fadeIn': {
      from: { opacity: 0 },
      to: { opacity: 1 },
    },
  },
  slideUp: {
    animation: 'slideUp 0.3s ease-out',
    '@keyframes slideUp': {
      from: { transform: 'translateY(20px)', opacity: 0 },
      to: { transform: 'translateY(0)', opacity: 1 },
    },
  },
}

export default theme